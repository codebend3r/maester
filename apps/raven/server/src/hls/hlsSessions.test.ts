import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { ServiceUnavailableException } from '@nestjs/common'
import {
  type AudioTrack,
  DEFAULT_PLAYBACK_SETTINGS,
  HLS_IDLE_MS,
  PLAYBACK_MODES,
  STREAM_TIME_SHIFT,
} from '@raven/core'
import { type MockInstance, afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { SOFTWARE } from '@/ffmpeg/encoder'
import { type FfmpegStream, FfmpegService } from '@/ffmpeg/ffmpegService'
import {
  HLS_SEGMENT_WAIT_MS,
  HLS_SESSION_CAP,
  type HlsClock,
  type HlsSession,
  HlsSessions,
  RUN_SIGNALS,
} from '@/hls/hlsSessions'
import { MP4_BOXES, segmentFileName } from '@/hls/segmentFiles'
import { type SegmentPlan, remuxPlan } from '@/hls/segmentPlan'
import { eventually, testConfig } from '@/test/app'
import { encodeRichClip } from '@/test/clips'

const run = promisify(execFile)

const CUES = '1\n00:00:01,000 --> 00:00:02,000\nHello\n'

/**
 * How a paced run reads: its first `burst` seconds at once, then `rate`
 * times real time, like a share slower than ffmpeg. ffmpeg 9 keeps a rate
 * up to about 12; asked for more, it read slower than real time here.
 */
type Pace = { rate: number; burst?: number }

/** Each run's first segment comes at once, and each next one 1.25 s later. */
const PACE: Pace = { rate: 4, burst: 7 }

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
  pace: Pace | null = null

  override segment(args: string[]): FfmpegStream {
    const pace = this.pace
    const reading =
      pace == null
        ? []
        : [
            '-readrate',
            String(pace.rate),
            ...(pace.burst == null ? [] : ['-readrate_initial_burst', String(pace.burst)]),
          ]
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
    await Promise.all([
      encodeRichClip({ path: state.clip, seconds: 40, cues: CUES, bFrames: 2 }),
      encodeRichClip({ path: state.long, seconds: 80, cues: CUES }),
    ])
    const ffmpeg = ffmpegFor(join(state.root, 'probe'))
    const [plan, longPlan, { tracks }, frames] = await Promise.all([
      planOf({ ffmpeg, path: state.clip }),
      planOf({ ffmpeg, path: state.long }),
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

  const open = ({ pace = null }: { pace?: Pace | null } = {}) => {
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
  }: {
    sessions: HlsSessions
    mediaId?: number
    input?: string
    plan?: SegmentPlan
  }): HlsSession =>
    sessions.mint({
      mediaId,
      mode: PLAYBACK_MODES.remux,
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
    const { ffmpeg, sessions } = open({ pace: PACE })
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

  it('serves a scrub back and forth with one ffmpeg left running', async () => {
    const { ffmpeg, sessions } = open({ pace: PACE })
    const session = mintIn({ sessions })
    const asked = [0, 5, 2, 6, 1]

    const served = await Promise.all(asked.map((n) => sessions.segment({ session: session.id, n })))

    expect(ffmpeg.runs).toHaveLength(asked.length)
    expect(ffmpeg.alive().length).toBeLessThanOrEqual(1)
    const init = await sessions.init({ session: session.id })
    const starts = await Promise.all(
      served.map(async (media) => (await videoOf({ init, media })).firstPts),
    )
    starts.forEach((start, index) => {
      expect(start).toBeCloseTo(boundary(asked[index] ?? NaN) + STREAM_TIME_SHIFT, 3)
    })
  })

  it('drops a session unasked for a minute, its run and its folder', async () => {
    const { ffmpeg, sessions, advance, dataDir } = open({ pace: PACE })
    const session = mintIn({ sessions })
    await sessions.segment({ session: session.id, n: 0 })
    const folder = join(dataDir, 'hls', session.id)
    const [first] = ffmpeg.runs

    expect(existsSync(folder)).toBe(true)
    advance(HLS_IDLE_MS - 1)
    expect(first?.kill).not.toHaveBeenCalled()
    advance(1)

    expect(first?.kill).toHaveBeenCalledWith(RUN_SIGNALS.kill)
    await eventually({ read: async () => existsSync(folder), check: (exists) => !exists })
    expect(sessions.get({ mediaId: 1, session: session.id })).toBeNull()
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
    // The first eleven segments come at once, the rest slowly.
    const { ffmpeg, sessions } = open({ pace: { rate: 2, burst: 67 } })
    const session = mintIn({ sessions, input: state.long, plan: state.longPlan })
    await sessions.segment({ session: session.id, n: 0 })
    const [first] = ffmpeg.runs
    const stateOf = async (): Promise<string> =>
      (await run('ps', ['-o', 'stat=', '-p', String(first?.child.pid)])).stdout.trim()

    await eventually({
      read: async () => first?.kill.mock.calls.flat() ?? [],
      check: (signals) => signals.includes(RUN_SIGNALS.stop),
    })
    expect(await stateOf()).toMatch(/^T/)

    await sessions.segment({ session: session.id, n: 3 })

    expect(first?.kill.mock.calls.flat()).toEqual([RUN_SIGNALS.stop, RUN_SIGNALS.resume])
    expect(await stateOf()).not.toMatch(/^T/)
  })

  it('gives up waiting for a segment after thirty seconds', async () => {
    const { sessions, advance, pending } = open({ pace: { rate: 0.5 } })
    const session = mintIn({ sessions })

    const waiting = sessions.segment({ session: session.id, n: 0 })
    // The idle timer and the wait's.
    await eventually({ read: async () => pending(), check: (count) => count >= 2 })
    advance(HLS_SEGMENT_WAIT_MS)

    await expect(waiting).rejects.toBeInstanceOf(ServiceUnavailableException)
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
