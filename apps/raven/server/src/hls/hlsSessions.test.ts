import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import {
  type AudioTrack,
  DEFAULT_PLAYBACK_SETTINGS,
  HLS_IDLE_MS,
  HLS_KEPT_SEGMENTS,
  MEDIA_TICKET_SECONDS,
  PLAYBACK_MODES,
  STREAM_TIME_SHIFT,
  type StreamMode,
} from '@raven/core'
import { type MockInstance, afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { SOFTWARE } from '@/ffmpeg/encoder'
import { type FfmpegStream, FfmpegService } from '@/ffmpeg/ffmpegService'
import {
  HLS_INIT_GRACE_MS,
  HLS_SEGMENT_WAIT_MS,
  HLS_SESSION_CAP,
  type HlsClock,
  type HlsSession,
  HlsSessions,
  RUN_SIGNALS,
  segmentsPastKeeping,
} from '@/hls/hlsSessions'
import { MP4_BOXES, segmentFileName } from '@/hls/segmentFiles'
import { type SegmentPlan, remuxPlan, transcodePlan } from '@/hls/segmentPlan'
import { eventually, testConfig } from '@/test/app'
import { encodeRichClip } from '@/test/clips'

const run = promisify(execFile)

const CUES = '1\n00:00:01,000 --> 00:00:02,000\nHello\n'

/**
 * How many times real time a paced run reads, like a share slower than
 * ffmpeg: a six-second segment every 0.75 s. `-readrate` is in FFmpeg 5.1
 * to 9.0 alike; 9.0 keeps a rate up to about 12 and reads slower than real
 * time when asked for more, and 5.1 has no `-readrate_initial_burst`.
 */
const PACE = 8

/** How many times the 40-second clip plays in the long one: about 21 minutes, 213 segments. */
const LONG_LOOPS = 32

/** The boxes inside a track and a fragment that hold the clock. */
const TRACK_BOXES = {
  track: 'trak',
  trackHeader: 'tkhd',
  media: 'mdia',
  mediaHeader: 'mdhd',
  trackFragment: 'traf',
  trackFragmentHeader: 'tfhd',
  decodeTime: 'tfdt',
} as const

/** The full box version 1 widens the times before the field read. */
const WIDE_VERSION = 1

/**
 * ffmpeg as the sessions run it, keeping each run's arguments and process
 * with a spy on its `kill`. With a `pace` it reads slower than it can, so a
 * run is still writing when the next request comes.
 */
class WatchedFfmpeg extends FfmpegService {
  readonly runs: { args: string[]; child: FfmpegStream; kill: MockInstance }[] = []
  pace: number | null = null

  override segment(args: string[]): FfmpegStream {
    const pace = this.pace
    const reading = pace == null ? [] : ['-readrate', String(pace)]
    const paced = args.flatMap((arg) => (arg === '-i' ? [...reading, arg] : [arg]))
    const child = super.segment(paced)
    this.runs.push({ args, child, kill: vi.spyOn(child, 'kill') })
    return child
  }

  alive(): FfmpegStream[] {
    return this.runs
      .map(({ child }) => child)
      .filter((child) => child.exitCode === null && child.signalCode === null)
  }
}

/** A clock that moves only when the test says, firing what falls due. */
const manualClock = () => {
  const state = { now: 0, timers: new Set<{ at: number; run: () => void }>() }
  const clock: HlsClock = {
    now: () => state.now,
    after: ({ ms, run: fire }) => {
      const timer = { at: state.now + ms, run: fire }
      state.timers.add(timer)
      return () => {
        state.timers.delete(timer)
      }
    },
  }
  const advance = (ms: number): void => {
    state.now += ms
    const due = [...state.timers].filter((timer) => timer.at <= state.now)
    due.forEach((timer) => {
      state.timers.delete(timer)
      timer.run()
    })
  }
  return { clock, advance, pending: () => state.timers.size }
}

type Box = { type: string; start: number; end: number; body: number }

const boxesIn = ({ bytes, start, end }: { bytes: Buffer; start: number; end: number }): Box[] => {
  if (start >= end) return []
  const small = bytes.readUInt32BE(start)
  const isLarge = small === 1
  const size = isLarge ? Number(bytes.readBigUInt64BE(start + 8)) : small
  const box = {
    type: bytes.toString('ascii', start + 4, start + 8),
    start,
    end: start + size,
    body: start + (isLarge ? 16 : 8),
  }
  return [box, ...boxesIn({ bytes, start: box.end, end })]
}

const topBoxes = (bytes: Buffer): Box[] => boxesIn({ bytes, start: 0, end: bytes.length })

const inside = ({ bytes, box, type }: { bytes: Buffer; box: Box | undefined; type: string }) =>
  box
    ? boxesIn({ bytes, start: box.body, end: box.end }).filter((child) => child.type === type)
    : []

/** Reads a full box's field `offset` bytes past its version and flags, wider in version 1. */
const fullBoxField = ({
  bytes,
  box,
  narrow,
  wide,
}: {
  bytes: Buffer
  box: Box | undefined
  narrow: number
  wide: number
}): number => {
  if (!box) throw new Error('Missing box')
  return bytes.readUInt32BE(box.body + (bytes[box.body] === WIDE_VERSION ? wide : narrow))
}

/** The video track's decode time at the segment's first fragment, in seconds. */
const videoTfdt = ({ init, media }: { init: Buffer; media: Buffer }): number => {
  const moov = topBoxes(init).find((box) => box.type === MP4_BOXES.movie)
  const [trak] = inside({ bytes: init, box: moov, type: TRACK_BOXES.track })
  const [tkhd] = inside({ bytes: init, box: trak, type: TRACK_BOXES.trackHeader })
  const [mdia] = inside({ bytes: init, box: trak, type: TRACK_BOXES.media })
  const [mdhd] = inside({ bytes: init, box: mdia, type: TRACK_BOXES.mediaHeader })
  const trackId = fullBoxField({ bytes: init, box: tkhd, narrow: 12, wide: 20 })
  const timescale = fullBoxField({ bytes: init, box: mdhd, narrow: 12, wide: 20 })

  const moof = topBoxes(media).find((box) => box.type === MP4_BOXES.fragment)
  const traf = inside({ bytes: media, box: moof, type: TRACK_BOXES.trackFragment }).find(
    (candidate) => {
      const [tfhd] = inside({ bytes: media, box: candidate, type: TRACK_BOXES.trackFragmentHeader })
      return tfhd != null && media.readUInt32BE(tfhd.body + 4) === trackId
    },
  )
  const [tfdt] = inside({ bytes: media, box: traf, type: TRACK_BOXES.decodeTime })
  if (!tfdt) throw new Error('No tfdt for the video track')
  const decodeTime =
    media[tfdt.body] === WIDE_VERSION
      ? Number(media.readBigUInt64BE(tfdt.body + 4))
      : media.readUInt32BE(tfdt.body + 4)
  return decodeTime / timescale
}

const mdatOf = (media: Buffer): Buffer =>
  Buffer.concat(
    topBoxes(media)
      .filter((box) => box.type === MP4_BOXES.mediaData)
      .map((box) => media.subarray(box.start, box.end)),
  )

const argAfter = ({ args, flag }: { args: string[]; flag: string }): string | undefined =>
  args[args.indexOf(flag) + 1]

describe('HlsSessions', () => {
  const state: {
    root: string
    clip: string
    long: string
    plan: SegmentPlan
    longPlan: SegmentPlan
    /** The 40-second clip cut at every keyframe, two seconds apart. */
    keyframePlan: SegmentPlan
    audio: AudioTrack | null
    hasBFrames: boolean
    probes: number
    dataDirs: number
  } = {
    root: '',
    clip: '',
    long: '',
    plan: { boundaries: [], duration: 0 },
    longPlan: { boundaries: [], duration: 0 },
    keyframePlan: { boundaries: [], duration: 0 },
    audio: null,
    hasBFrames: false,
    probes: 0,
    dataDirs: 0,
  }
  const opened: HlsSessions[] = []

  const ffmpegFor = (dataDir: string) =>
    new WatchedFfmpeg(testConfig({ dataDir, mediaDir: state.root }), {
      playback: () => DEFAULT_PLAYBACK_SETTINGS,
    })

  const planOf = async ({ ffmpeg, path }: { ffmpeg: FfmpegService; path: string }) => {
    const [keyframes, { probe }] = await Promise.all([
      ffmpeg.probeKeyframes(path),
      ffmpeg.probeFile(path),
    ])
    const plan = remuxPlan({ keyframes, duration: probe.duration ?? 0 })
    if (!plan) throw new Error(`No remux plan for ${path}`)
    return plan
  }

  beforeAll(async () => {
    state.root = await mkdtemp(join(tmpdir(), 'raven-hls-'))
    state.clip = join(state.root, 'clip.mkv')
    state.long = join(state.root, 'long.mkv')
    await encodeRichClip({ path: state.clip, seconds: 40, cues: CUES, bFrames: 2 })
    await run('ffmpeg', [
      '-v',
      'error',
      '-stream_loop',
      String(LONG_LOOPS - 1),
      '-i',
      state.clip,
      '-map',
      '0:v',
      '-map',
      '0:a',
      '-c',
      'copy',
      state.long,
    ])
    const ffmpeg = ffmpegFor(join(state.root, 'probe'))
    const [plan, longPlan, keyframes, { tracks }, frames] = await Promise.all([
      planOf({ ffmpeg, path: state.clip }),
      planOf({ ffmpeg, path: state.long }),
      ffmpeg.probeKeyframes(state.clip),
      ffmpeg.probeFile(state.clip),
      run('ffprobe', [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=has_b_frames',
        '-of',
        'csv=p=0',
        state.clip,
      ]),
    ])
    state.plan = plan
    state.longPlan = longPlan
    state.keyframePlan = {
      boundaries: keyframes.filter((keyframe) => keyframe < plan.duration),
      duration: plan.duration,
    }
    // The AAC commentary, which every HLS player decodes.
    state.audio = tracks.audio[1] ?? null
    state.hasBFrames = Number(frames.stdout.trim()) > 0
  })

  afterEach(async () => {
    await Promise.all(opened.splice(0).map((sessions) => sessions.onModuleDestroy()))
  })

  afterAll(async () => {
    await rm(state.root, { recursive: true, force: true })
  })

  const open = ({ pace = null }: { pace?: number | null } = {}) => {
    state.dataDirs += 1
    const dataDir = join(state.root, `data-${state.dataDirs}`)
    const ffmpeg = ffmpegFor(dataDir)
    ffmpeg.pace = pace
    const { clock, advance, pending } = manualClock()
    const sessions = new HlsSessions(testConfig({ dataDir, mediaDir: state.root }), ffmpeg, clock)
    sessions.onModuleInit()
    opened.push(sessions)
    return { ffmpeg, sessions, advance, pending, dataDir }
  }

  const mintIn = ({
    sessions,
    mediaId = 1,
    input = state.clip,
    plan = state.plan,
    mode = PLAYBACK_MODES.remux,
  }: {
    sessions: HlsSessions
    mediaId?: number
    input?: string
    plan?: SegmentPlan
    mode?: StreamMode
  }): HlsSession =>
    sessions.mint({
      mediaId,
      mode,
      audio: state.audio,
      quality: null,
      plan,
      encoding: {
        input,
        videoCodec: 'h264',
        encoder: SOFTWARE,
        maxHeight: 1080,
        quality: 'medium',
        bitrate: null,
        tonemap: false,
      },
    })

  /** ffprobe's reading of the video in a segment played after its init. */
  const videoOf = async ({ init, media }: { init: Uint8Array; media: Uint8Array }) => {
    state.probes += 1
    const path = join(state.root, `probe-${state.probes}.mp4`)
    await writeFile(path, Buffer.concat([init, media]))
    const { stdout } = await run('ffprobe', [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'packet=pts_time,dts_time',
      '-of',
      'csv=p=0',
      path,
    ])
    const packets = stdout
      .trim()
      .split('\n')
      .map((line) => line.split(',').map(Number))
    return { count: packets.length, firstPts: packets[0]?.[0], firstDts: packets[0]?.[1] }
  }

  const boundary = (n: number): number => state.plan.boundaries[n] ?? NaN

  it('cuts segment 0 then 1 from one run', async () => {
    const { ffmpeg, sessions } = open()
    const session = mintIn({ sessions })

    await sessions.segment({ session: session.id, n: 0 })
    const second = await sessions.segment({ session: session.id, n: 1 })

    expect(ffmpeg.runs).toHaveLength(1)
    const init = await sessions.init({ session: session.id })
    expect((await videoOf({ init, media: second })).firstPts).toBeCloseTo(
      boundary(1) + STREAM_TIME_SHIFT,
      3,
    )
  })

  describe('a segment past the run', () => {
    const restart: {
      runs: WatchedFfmpeg['runs']
      /** The signals the first run got, read before the next test clears its spy. */
      firstSignals: unknown[]
      alive: number
      init: Uint8Array
      fifth: Uint8Array
      fresh: Uint8Array
    } = {
      runs: [],
      firstSignals: [],
      alive: 0,
      init: new Uint8Array(),
      fifth: new Uint8Array(),
      fresh: new Uint8Array(),
    }

    beforeAll(async () => {
      const { ffmpeg, sessions } = open({ pace: PACE })
      const session = mintIn({ sessions })
      await sessions.segment({ session: session.id, n: 0 })
      await sessions.segment({ session: session.id, n: 1 })
      restart.fifth = await sessions.segment({ session: session.id, n: 5 })
      restart.init = await sessions.init({ session: session.id })
      restart.runs = [...ffmpeg.runs]
      restart.firstSignals = ffmpeg.runs[0]?.kill.mock.calls.flat() ?? []
      restart.alive = ffmpeg.alive().length

      const other = open()
      const fresh = mintIn({ sessions: other.sessions })
      restart.fresh = await other.sessions.segment({ session: fresh.id, n: 5 })
    })

    it('kills the run and starts one at that segment', () => {
      const [, second] = restart.runs

      expect(restart.runs).toHaveLength(2)
      expect(restart.firstSignals).toEqual([RUN_SIGNALS.kill])
      expect(argAfter({ args: second?.args ?? [], flag: '-segment_start_number' })).toBe('5')
      expect(restart.alive).toBeLessThanOrEqual(1)
    })

    it('starts the segment at its boundary on the shifted clock', async () => {
      const video = await videoOf({ init: restart.init, media: restart.fifth })

      expect(video.firstPts).toBeCloseTo(boundary(5) + STREAM_TIME_SHIFT, 3)
    })

    it('serves the same bytes as a session that started there', () => {
      expect(Buffer.from(restart.fifth).equals(Buffer.from(restart.fresh))).toBe(true)
    })
  })

  it('cuts the same segment with B-frames from any start, each on its own decode time', async () => {
    const { sessions } = open()
    const fromZero = mintIn({ sessions })
    const fromFive = mintIn({ sessions })
    const zeroToSix = await [0, 1, 2, 3, 4, 5, 6].reduce<Promise<Uint8Array[]>>(
      async (done, n) => [...(await done), await sessions.segment({ session: fromZero.id, n })],
      Promise.resolve([]),
    )
    await sessions.segment({ session: fromFive.id, n: 5 })
    const sixAfterFive = await sessions.segment({ session: fromFive.id, n: 6 })
    const init = await sessions.init({ session: fromZero.id })
    const sixAfterZero = zeroToSix[6] ?? new Uint8Array()

    expect(state.hasBFrames).toBe(true)
    const [afterZero, afterFive] = await Promise.all([
      videoOf({ init, media: sixAfterZero }),
      videoOf({ init, media: sixAfterFive }),
    ])
    expect(afterFive.firstPts).toBe(afterZero.firstPts)
    expect(afterFive.count).toBe(afterZero.count)
    expect(mdatOf(Buffer.from(sixAfterFive)).equals(mdatOf(Buffer.from(sixAfterZero)))).toBe(true)

    const decodeTimes = await Promise.all(
      zeroToSix.map(async (media, n) => ({
        n,
        tfdt: videoTfdt({ init: Buffer.from(init), media: Buffer.from(media) }),
        firstDts: (await videoOf({ init, media })).firstDts,
      })),
    )
    decodeTimes.forEach(({ n, tfdt, firstDts }) => {
      expect(tfdt).toBeCloseTo(firstDts ?? NaN, 3)
      // The reorder delay puts the first dts a few frames before the boundary, never at zero.
      expect(tfdt).toBeGreaterThan(boundary(n) + STREAM_TIME_SHIFT - 0.5)
    })
  })

  it('cuts the same transcoded segment from any start', async () => {
    const { sessions } = open()
    const plan = transcodePlan({ duration: state.plan.duration })
    const fromZero = mintIn({ sessions, plan, mode: PLAYBACK_MODES.transcode })
    const fromFive = mintIn({ sessions, plan, mode: PLAYBACK_MODES.transcode })
    const zeroToSix = await [0, 1, 2, 3, 4, 5, 6].reduce<Promise<Uint8Array[]>>(
      async (done, n) => [...(await done), await sessions.segment({ session: fromZero.id, n })],
      Promise.resolve([]),
    )
    await sessions.segment({ session: fromFive.id, n: 5 })
    const sixAfterFive = await sessions.segment({ session: fromFive.id, n: 6 })
    const init = await sessions.init({ session: fromZero.id })

    const [afterZero, afterFive] = await Promise.all([
      videoOf({ init, media: zeroToSix[6] ?? new Uint8Array() }),
      videoOf({ init, media: sixAfterFive }),
    ])
    expect(afterFive.firstPts).toBe(afterZero.firstPts)
    expect(afterFive.count).toBe(afterZero.count)
    // The forced keyframe is the first frame at or after the boundary.
    expect(afterZero.firstPts).toBeCloseTo((plan.boundaries[6] ?? NaN) + STREAM_TIME_SHIFT, 1)
  })

  it('serves a scrub back and forth with one ffmpeg left running', async () => {
    const { ffmpeg, sessions } = open({ pace: PACE })
    const session = mintIn({ sessions })
    const asked = [0, 5, 2, 6, 1]

    const served = await Promise.all(asked.map((n) => sessions.segment({ session: session.id, n })))

    expect(ffmpeg.alive().length).toBeLessThanOrEqual(1)
    const init = await sessions.init({ session: session.id })
    const starts = await Promise.all(
      served.map(async (media) => (await videoOf({ init, media })).firstPts),
    )
    starts.forEach((start, index) => {
      expect(start).toBeCloseTo(boundary(asked[index] ?? NaN) + STREAM_TIME_SHIFT, 3)
    })
  })

  it('rests a session unasked for a minute, and resumes it with a new run', async () => {
    const { ffmpeg, sessions, advance, dataDir } = open({ pace: PACE })
    const session = mintIn({ sessions })
    await sessions.segment({ session: session.id, n: 0 })
    const init = await sessions.init({ session: session.id })
    const folder = join(dataDir, 'hls', session.id)
    const [first] = ffmpeg.runs

    expect(existsSync(folder)).toBe(true)
    advance(HLS_IDLE_MS - 1)
    expect(first?.kill).not.toHaveBeenCalled()
    advance(1)

    // The rest takes its turn after whatever the session was doing.
    await eventually({ read: async () => existsSync(folder), check: (exists) => !exists })
    expect(first?.kill).toHaveBeenCalledWith(RUN_SIGNALS.kill)
    expect(ffmpeg.alive()).toHaveLength(0)
    // The init outlives the rest, so it needs no run.
    expect(
      Buffer.from(await sessions.init({ session: session.id })).equals(Buffer.from(init)),
    ).toBe(true)
    expect(ffmpeg.runs).toHaveLength(1)

    const third = await sessions.segment({ session: session.id, n: 3 })

    const [, second] = ffmpeg.runs
    expect(argAfter({ args: second?.args ?? [], flag: '-segment_start_number' })).toBe('3')
    expect((await videoOf({ init, media: third })).firstPts).toBeCloseTo(
      boundary(3) + STREAM_TIME_SHIFT,
      3,
    )
  })

  it('forgets a session once no ticket that opened it can still be good', async () => {
    const { sessions, advance } = open()
    const session = mintIn({ sessions })

    advance(HLS_IDLE_MS)
    expect(sessions.get({ mediaId: 1, session: session.id })).not.toBeNull()
    advance(MEDIA_TICKET_SECONDS * 1000)

    expect(sessions.get({ mediaId: 1, session: session.id })).toBeNull()
    await expect(sessions.segment({ session: session.id, n: 0 })).rejects.toBeInstanceOf(
      NotFoundException,
    )
  })

  it('drops the longest idle session to mint one past the cap', () => {
    const { sessions, advance } = open()
    const minted = Array.from({ length: HLS_SESSION_CAP }, () => {
      const session = mintIn({ sessions })
      advance(1)
      return session
    })
    const [oldest, next] = minted
    // Asked for again, the oldest is no longer the longest idle.
    sessions.get({ mediaId: 1, session: oldest?.id ?? '' })

    const ninth = mintIn({ sessions })

    expect(sessions.get({ mediaId: 1, session: next?.id ?? '' })).toBeNull()
    expect(sessions.get({ mediaId: 1, session: oldest?.id ?? '' })).not.toBeNull()
    expect(sessions.get({ mediaId: 1, session: ninth.id })?.id).toBe(ninth.id)
  })

  it('pauses a run ten segments past the furthest asked, and resumes it when asked further', async () => {
    // Two-second segments at the pace: one every quarter second, and the run
    // lasts five seconds, so it is alive and mid-file when it is paused.
    const { ffmpeg, sessions } = open({ pace: PACE })
    const session = mintIn({ sessions, plan: state.keyframePlan })
    await sessions.segment({ session: session.id, n: 0 })
    const [first] = ffmpeg.runs
    const signals = () => first?.kill.mock.calls.flat() ?? []
    const stateOf = async (): Promise<string> =>
      (await run('ps', ['-o', 'stat=', '-p', String(first?.child.pid)])).stdout.trim()

    await eventually({ read: async () => signals(), check: (sent) => sent.length === 1 })
    expect(signals()).toEqual([RUN_SIGNALS.stop])
    expect(await stateOf()).toMatch(/^T/)

    await sessions.segment({ session: session.id, n: 3 })

    expect(signals()).toEqual([RUN_SIGNALS.stop, RUN_SIGNALS.resume])
    // Resumed, it runs on to ten past segment 3 and is paused there again.
    await eventually({ read: async () => signals(), check: (sent) => sent.length === 3 })
    expect(signals()).toEqual([RUN_SIGNALS.stop, RUN_SIGNALS.resume, RUN_SIGNALS.stop])
  })

  it('restarts for a far request without waiting out a near one', async () => {
    const { ffmpeg, sessions } = open({ pace: PACE })
    const session = mintIn({ sessions, input: state.long, plan: state.longPlan })
    await sessions.segment({ session: session.id, n: 0 })
    const finished: number[] = []
    const asked = (n: number) =>
      sessions.segment({ session: session.id, n }).then((media) => {
        finished.push(n)
        return media
      })

    // Segment 3 is near the run, which writes it about 2.25 s from now.
    const near = asked(3)
    const started = Date.now()
    await asked(40)

    // Far from the near request's wait, and nowhere near the thirty-second one.
    expect(finished).toEqual([40])
    expect(Date.now() - started).toBeLessThan(10_000)
    const third = await near
    const init = await sessions.init({ session: session.id })
    expect((await videoOf({ init, media: third })).firstPts).toBeCloseTo(
      (state.longPlan.boundaries[3] ?? NaN) + STREAM_TIME_SHIFT,
      3,
    )
    expect(ffmpeg.alive().length).toBeLessThanOrEqual(1)
  })

  it('cuts the init from the run the next segment starts, not a run of its own', async () => {
    const { ffmpeg, sessions } = open()
    const session = mintIn({ sessions })

    const init = sessions.init({ session: session.id })
    const fifth = await sessions.segment({ session: session.id, n: 5 })

    expect(ffmpeg.runs).toHaveLength(1)
    expect(argAfter({ args: ffmpeg.runs[0]?.args ?? [], flag: '-segment_start_number' })).toBe('5')
    expect((await videoOf({ init: await init, media: fifth })).firstPts).toBeCloseTo(
      boundary(5) + STREAM_TIME_SHIFT,
      3,
    )
  })

  it('starts a run at 0 for the init after a short grace with no segment asked for', async () => {
    const { ffmpeg, sessions, advance, pending } = open()
    const session = mintIn({ sessions })

    const started = Date.now()
    const init = sessions.init({ session: session.id })
    // The rest, the forgetting and the init's grace.
    await eventually({ read: async () => pending(), check: (count) => count >= 3 })
    expect(ffmpeg.runs).toHaveLength(0)
    advance(HLS_INIT_GRACE_MS)

    expect((await init).length).toBeGreaterThan(0)
    expect(Date.now() - started).toBeLessThan(HLS_SEGMENT_WAIT_MS / 3)
    expect(argAfter({ args: ffmpeg.runs[0]?.args ?? [], flag: '-segment_start_number' })).toBe('0')
  })

  it('serves an init and then a far segment, leaving one run, at the segment', async () => {
    const { ffmpeg, sessions, advance, pending } = open()
    const session = mintIn({ sessions, input: state.long, plan: state.longPlan })

    // As ExoPlayer does: the init first, and the segment only once it came.
    const init = sessions.init({ session: session.id })
    await eventually({ read: async () => pending(), check: (count) => count >= 3 })
    advance(HLS_INIT_GRACE_MS)
    const header = await init
    const fortieth = await sessions.segment({ session: session.id, n: 40 })

    const [atZero, atForty] = ffmpeg.runs
    expect(ffmpeg.runs).toHaveLength(2)
    expect(atZero?.kill).toHaveBeenCalledWith(RUN_SIGNALS.kill)
    expect(argAfter({ args: atForty?.args ?? [], flag: '-segment_start_number' })).toBe('40')
    expect(ffmpeg.alive().every((child) => child === atForty?.child)).toBe(true)
    expect((await videoOf({ init: header, media: fortieth })).firstPts).toBeCloseTo(
      (state.longPlan.boundaries[40] ?? NaN) + STREAM_TIME_SHIFT,
      3,
    )
  })

  it('reads the init again after a read that failed', async () => {
    const { sessions, dataDir } = open()
    const session = mintIn({ sessions })
    await sessions.segment({ session: session.id, n: 0 })
    // The first run's folder holds its first file, which the init is cut from.
    const source = join(dataDir, 'hls', session.id, '1', segmentFileName(0))
    await rename(source, `${source}.away`)

    await expect(sessions.init({ session: session.id })).rejects.toThrow()
    await rename(`${source}.away`, source)

    expect((await sessions.init({ session: session.id })).length).toBeGreaterThan(0)
  })

  it('keeps a run going after an error event once it has spawned', async () => {
    const { ffmpeg, sessions } = open({ pace: PACE })
    const session = mintIn({ sessions })
    await sessions.segment({ session: session.id, n: 0 })

    ffmpeg.runs[0]?.child.emit('error', new Error('A signal could not be sent'))
    await sessions.segment({ session: session.id, n: 1 })

    expect(ffmpeg.runs).toHaveLength(1)
  })

  it('gives up waiting for a segment after thirty seconds', async () => {
    const { sessions, advance, pending } = open({ pace: 0.5 })
    const session = mintIn({ sessions })

    const waiting = sessions.segment({ session: session.id, n: 0 })
    // The rest, the forgetting and the wait.
    await eventually({ read: async () => pending(), check: (count) => count >= 3 })
    advance(HLS_SEGMENT_WAIT_MS)

    await expect(waiting).rejects.toBeInstanceOf(ServiceUnavailableException)
  })

  it('keeps exactly the last thirty segments at or behind the furthest asked', () => {
    const segments = Array.from({ length: 41 }, (_, n) => n)

    const gone = segmentsPastKeeping({ segments, furthest: 40 })

    expect(gone).toEqual(Array.from({ length: 11 }, (_, n) => n))
    expect(segments.filter((n) => !gone.includes(n))).toHaveLength(HLS_KEPT_SEGMENTS)
  })

  it('drops every session of a media, and empties the HLS folder on start', async () => {
    const { ffmpeg, sessions, dataDir } = open({ pace: PACE })
    const first = mintIn({ sessions })
    const second = mintIn({ sessions })
    const kept = mintIn({ sessions, mediaId: 2 })
    await sessions.segment({ session: first.id, n: 0 })
    const folder = join(dataDir, 'hls', first.id)

    sessions.drop({ mediaId: 1 })

    expect(sessions.get({ mediaId: 1, session: first.id })).toBeNull()
    expect(sessions.get({ mediaId: 1, session: second.id })).toBeNull()
    expect(sessions.get({ mediaId: 2, session: kept.id })).not.toBeNull()
    expect(ffmpeg.runs[0]?.kill).toHaveBeenCalledWith(RUN_SIGNALS.kill)
    await eventually({ read: async () => existsSync(folder), check: (exists) => !exists })

    const stale = join(dataDir, 'hls', 'stale')
    await mkdir(stale, { recursive: true })
    await writeFile(join(stale, segmentFileName(0)), 'left by a run before a restart')
    sessions.onModuleInit()
    expect(existsSync(stale)).toBe(false)
  })

  it('refuses an unknown session and a segment the plan does not have', async () => {
    const { sessions } = open()
    const session = mintIn({ sessions })

    expect(sessions.get({ mediaId: 2, session: session.id })).toBeNull()
    await expect(sessions.segment({ session: 'unknown', n: 0 })).rejects.toThrow(/session/)
    await expect(
      sessions.segment({ session: session.id, n: state.plan.boundaries.length }),
    ).rejects.toThrow(/segment/)
  })
})
