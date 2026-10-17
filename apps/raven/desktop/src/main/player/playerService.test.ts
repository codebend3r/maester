import { describe, expect, test } from 'bun:test'
import type { OutputSettings, PlayerCommand, PlayerEvent } from '@raven/core'
import {
  type MpvEvent,
  type MpvProperty,
  type MpvPropertyValue,
  type MpvReply,
  type MpvTrack,
  propertyGuards,
} from '@raven/mpv'
import {
  BUFFERED_MS,
  createPlayerService,
  type MpvControl,
  OBSERVED,
  PLAYER_MESSAGES,
  type PlayerActivity,
  resolveSourceWith,
  TIME_MS,
} from '@/main/player/playerService'
import type { Timers } from '@/main/stateStore'

const mpvTrack = (fields: Pick<MpvTrack, 'id' | 'type'> & Partial<MpvTrack>): MpvTrack => ({
  selected: undefined,
  default: undefined,
  external: undefined,
  forced: undefined,
  'hearing-impaired': undefined,
  lang: undefined,
  title: undefined,
  codec: undefined,
  'demux-channel-count': undefined,
  ...fields,
})

const LIST: MpvTrack[] = [
  mpvTrack({ id: 1, type: 'video', codec: 'hevc' }),
  mpvTrack({ id: 1, type: 'audio', lang: 'eng', codec: 'truehd', default: true }),
  mpvTrack({ id: 2, type: 'audio', lang: 'fra', codec: 'ac3' }),
  mpvTrack({ id: 1, type: 'sub', lang: 'eng', codec: 'subrip' }),
  mpvTrack({ id: 2, type: 'sub', lang: 'spa', codec: 'subrip' }),
]

const LOAD = {
  type: 'load',
  source: { kind: 'file', fileId: 'f1' },
  start: 0,
  audio: null,
  subtitle: 'embedded-0',
} as const satisfies PlayerCommand

const PCM: OutputSettings = { profile: 'pcm', device: 'auto', passthrough: [], spatial: false }
const PASSTHROUGH: OutputSettings = { ...PCM, profile: 'passthrough', passthrough: ['ac3'] }

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

const isValueOf =
  <K extends MpvProperty>(name: K) =>
  (value: unknown): value is MpvPropertyValue<K> =>
    propertyGuards[name](value)

type Held = {
  entry: string
  resolve: () => void
  reject: (error: Error) => void
  onReply: (reply: MpvReply) => void
}

const ignoreReply = () => {}

/**
 * A scripted mpv: every call answers asynchronously, can be held until released,
 * failed by prefix, or rejected the way the wrapper rejects on destroy and shutdown.
 */
const createFakeMpv = () => {
  const log: string[] = []
  const reads: string[] = []
  const observed: string[] = []
  const values = new Map<string, unknown>([
    ['track-list', LIST],
    ['container-fps', 23.976],
    ['pause', false],
    ['duration', 120],
    ['speed', 1],
    ['time-pos', null],
  ])
  const held: Held[] = []
  const failing = new Set<string>()
  const flags: { holding: string | null; isDestroyed: boolean } = {
    holding: null,
    isDestroyed: false,
  }
  const sink: { receive: (event: MpvEvent) => void } = { receive: () => {} }

  // Like the wrapper: `onReply` runs as the reply arrives, told whether mpv accepted it.
  const answer = ({ entry, resolve, reject, onReply }: Held) => {
    const isFailing = [...failing].some((prefix) => entry.startsWith(prefix))
    onReply({ isOk: !isFailing })
    if (isFailing) {
      reject(new Error('mpv request failed (-12)'))
      return
    }
    resolve()
  }
  const reply = ({
    entry,
    onReply = ignoreReply,
  }: {
    entry: string
    onReply?: (reply: MpvReply) => void
  }) =>
    new Promise<void>((resolve, reject) => {
      if (flags.isDestroyed) {
        reject(new Error('mpv is destroyed'))
        return
      }
      if (flags.holding !== null && entry.startsWith(flags.holding)) {
        held.push({ entry, resolve, reject, onReply })
        return
      }
      answer({ entry, resolve, reject, onReply })
    })
  const rejectHeld = (message: string) => {
    held.splice(0).forEach((request) => request.reject(new Error(message)))
  }

  const control: MpvControl = {
    command: async ({ args, onReply }) => {
      const entry = args.join(' ')
      log.push(entry)
      await reply({ entry, onReply })
    },
    set: async ({ name, value }) => {
      const entry = `set ${name} ${String(value)}`
      log.push(entry)
      await reply({ entry })
    },
    read: async <K extends MpvProperty>({ name }: { name: K }) => {
      reads.push(name)
      await reply({ entry: `read ${name}` })
      const value = values.get(name)
      if (!isValueOf(name)(value)) throw new Error('mpv request failed (-10)')
      return value
    },
    observe: ({ name }) => {
      observed.push(name)
    },
  }

  return {
    control,
    log,
    reads,
    observed,
    values,
    connect: (receive: (event: MpvEvent) => void) => {
      sink.receive = receive
    },
    /** Holds the replies to calls starting with `prefix`, or to every call. */
    hold: (prefix = '') => {
      flags.holding = prefix
    },
    release: () => {
      flags.holding = null
      held.splice(0).forEach(answer)
    },
    /** Answers what is held newest first, as no ordered stream would. */
    releaseNewestFirst: () => {
      flags.holding = null
      held.splice(0).toReversed().forEach(answer)
    },
    failOn: (prefix: string) => {
      failing.add(prefix)
    },
    /** The wrapper's destroy rejects what is in flight and then hears nothing more. */
    destroy: () => {
      flags.isDestroyed = true
      rejectHeld('mpv is destroyed')
    },
    /** The wrapper's shutdown rejects what is in flight, then passes the event on. */
    shutdown: () => {
      rejectHeld('mpv shutdown')
      sink.receive({ type: 'shutdown' })
    },
  }
}

const createFakeTimers = () => {
  const pending = new Map<number, { run: () => void; ms: number }>()
  const counter = { next: 1 }
  const timers: Timers = {
    set: (run, ms) => {
      const handle = counter.next
      counter.next += 1
      pending.set(handle, { run, ms })
      return handle
    },
    clear: (handle) => {
      if (typeof handle === 'number') pending.delete(handle)
    },
  }
  const fire = () => {
    const due = [...pending.values()]
    pending.clear()
    due.forEach((timer) => timer.run())
  }
  return { timers, fire, pending }
}

const fileOf = (fileId: string) =>
  fileId === 'f1' ? { fileId, path: '/m/Film.mkv', name: 'Film.mkv', size: 1, mtimeMs: 1 } : null

const setup = () => {
  const mpv = createFakeMpv()
  const clock = createFakeTimers()
  const events: PlayerEvent[] = []
  const activity: PlayerActivity[] = []
  const warnings: string[] = []
  const counts = { firstFrames: 0 }
  const service = createPlayerService({
    mpv: mpv.control,
    resolveSource: resolveSourceWith({ grants: { fileOf } }),
    canChooseAo: false,
    timers: clock.timers,
    onActivity: (next) => {
      activity.push(next)
    },
    onFirstFrame: () => {
      counts.firstFrames += 1
    },
    warn: (message) => {
      warnings.push(message)
    },
  })
  mpv.connect(service.receive)
  // Creation's hardening set is covered on its own; the rest start from a clean log.
  mpv.log.splice(0)
  service.subscribe((event) => {
    events.push(event)
  })
  const types = () => events.map((event) => event.type)
  const clear = () => {
    events.splice(0)
    mpv.log.splice(0)
    mpv.reads.splice(0)
    activity.splice(0)
  }
  const loaded = async (command: PlayerCommand = LOAD) => {
    expect(await service.handle(command)).toEqual({ ok: true })
    service.receive({ type: 'file-loaded' })
    await settle()
  }
  const time = (data: number | null) =>
    service.receive({ type: 'property', name: 'time-pos', data })
  const ranges = (list: { start: number; end: number }[]) =>
    service.receive({
      type: 'property',
      name: 'demuxer-cache-state',
      data: { 'seekable-ranges': list },
    })
  return {
    service,
    mpv,
    clock,
    events,
    activity,
    warnings,
    counts,
    types,
    clear,
    loaded,
    time,
    ranges,
  }
}

describe('hardening', () => {
  test('creation sets the hardened options before anything else', () => {
    const mpv = createFakeMpv()
    createPlayerService({
      mpv: mpv.control,
      resolveSource: resolveSourceWith({ grants: { fileOf } }),
      canChooseAo: false,
      timers: createFakeTimers().timers,
      onActivity: () => {},
      onFirstFrame: () => {},
      warn: () => {},
    })
    expect(mpv.log).toEqual(['set access-references false'])
  })

  test('a load is refused, and mpv untouched, when the hardening could not be set', async () => {
    const mpv = createFakeMpv()
    mpv.failOn('set access-references')
    const warnings: string[] = []
    const service = createPlayerService({
      mpv: mpv.control,
      resolveSource: resolveSourceWith({ grants: { fileOf } }),
      canChooseAo: false,
      timers: createFakeTimers().timers,
      onActivity: () => {},
      onFirstFrame: () => {},
      warn: (message) => {
        warnings.push(message)
      },
    })
    expect(await service.handle(LOAD)).toEqual({
      ok: false,
      reason: 'refused',
      message: PLAYER_MESSAGES.failed,
    })
    expect(await service.handle(LOAD)).toEqual({
      ok: false,
      reason: 'refused',
      message: PLAYER_MESSAGES.failed,
    })
    expect(mpv.log).toEqual(['set access-references false'])
    expect(warnings).toEqual(['mpv set access-references failed: mpv request failed (-12)'])
  })
})

describe('resolveSourceWith', () => {
  const resolve = resolveSourceWith({ grants: { fileOf } })

  test('a granted file resolves to its path', () => {
    expect(resolve({ kind: 'file', fileId: 'f1' })).toEqual({ ok: true, path: '/m/Film.mkv' })
  })

  test('an unknown file and a server title are refused', () => {
    expect(resolve({ kind: 'file', fileId: 'nope' })).toEqual({
      ok: false,
      message: PLAYER_MESSAGES.notOpen,
    })
    expect(resolve({ kind: 'server', serverId: 's1', mediaId: 4 })).toEqual({
      ok: false,
      message: PLAYER_MESSAGES.serverTitles,
    })
  })
})

describe('createPlayerService', () => {
  test('creation observes every property in order', () => {
    const { mpv } = setup()
    expect(mpv.observed).toEqual([...OBSERVED])
  })

  describe('load', () => {
    test('pauses off, then loads the granted path from a start of at least 0', async () => {
      const { service, mpv } = setup()
      expect(await service.handle({ ...LOAD, start: -3 })).toEqual({ ok: true })
      expect(mpv.log).toEqual(['set pause false', 'loadfile /m/Film.mkv replace -1 start=0'])
    })

    test('a server title and an unknown file are refused without touching mpv', async () => {
      const { service, mpv } = setup()
      expect(
        await service.handle({ ...LOAD, source: { kind: 'server', serverId: 's1', mediaId: 3 } }),
      ).toEqual({ ok: false, reason: 'refused', message: PLAYER_MESSAGES.serverTitles })
      expect(await service.handle({ ...LOAD, source: { kind: 'file', fileId: 'f2' } })).toEqual({
        ok: false,
        reason: 'refused',
        message: PLAYER_MESSAGES.notOpen,
      })
      expect(mpv.log).toEqual([])
    })

    test('extra fields on a command never reach mpv', async () => {
      const plain = setup()
      const forgedSetup = setup()
      const forged = { ...LOAD, start: 12.5, args: ['run', 'rm'], path: '/etc/hosts' }
      await plain.service.handle({ ...LOAD, start: 12.5 })
      await forgedSetup.service.handle(forged)
      expect(forgedSetup.mpv.log).toEqual(plain.mpv.log)
      expect(forgedSetup.mpv.log).toEqual([
        'set pause false',
        'loadfile /m/Film.mkv replace -1 start=12.5',
      ])
    })

    test('a rejected loadfile answers failed and leaves the service idle', async () => {
      const { service, mpv, events, warnings, activity } = setup()
      mpv.failOn('loadfile')
      expect(await service.handle(LOAD)).toEqual({
        ok: false,
        reason: 'refused',
        message: PLAYER_MESSAGES.failed,
      })
      expect(warnings.length).toBe(1)
      expect(activity).toEqual([
        { isPlaying: false, isShowing: true },
        { isPlaying: false, isShowing: false },
      ])
      service.receive({ type: 'file-loaded' })
      await settle()
      expect(events).toEqual([])
    })
  })

  describe('file-loaded', () => {
    test('events before it emit nothing; it emits a snapshot and applies the wanted tracks', async () => {
      const { service, mpv, events, types, time } = setup()
      await service.handle({ ...LOAD, audio: 1, subtitle: null })
      time(4)
      service.receive({ type: 'property', name: 'duration', data: 120 })
      expect(events).toEqual([])
      mpv.log.splice(0)
      service.receive({ type: 'file-loaded' })
      await settle()
      expect(mpv.log).toEqual(['set aid 2', 'set sid no'])
      expect(types()).toEqual(['paused', 'duration', 'rate', 'waiting', 'tracks'])
      expect(events.slice(0, 4)).toEqual([
        { type: 'paused', paused: false },
        { type: 'duration', duration: 120 },
        { type: 'rate', rate: 1 },
        { type: 'waiting', waiting: false },
      ])
      const tracks = events[4]
      if (tracks === undefined || tracks.type !== 'tracks') throw new Error('expected tracks')
      expect(tracks.tracks.audio.map((track) => track.language)).toEqual(['en', 'fr'])
      expect(tracks.tracks.subtitles.map((track) => track.id)).toEqual(['embedded-0', 'embedded-1'])
      expect(tracks.tracks.frameRate).toBe(23.976)
    })

    test('null audio is auto, a subtitle id maps to its mpv id, unknown picks fall back', async () => {
      const first = setup()
      await first.service.handle({ ...LOAD, audio: null, subtitle: 'embedded-1' })
      first.mpv.log.splice(0)
      first.service.receive({ type: 'file-loaded' })
      await settle()
      expect(first.mpv.log).toEqual(['set aid auto', 'set sid 2'])

      const second = setup()
      await second.service.handle({ ...LOAD, audio: 7, subtitle: 'embedded-9' })
      second.mpv.log.splice(0)
      second.service.receive({ type: 'file-loaded' })
      await settle()
      expect(second.mpv.log).toEqual(['set aid auto', 'set sid no'])
    })

    test('a failing read falls back and is warned, still emitting the snapshot', async () => {
      const { mpv, events, warnings, loaded } = setup()
      mpv.failOn('read track-list')
      await loaded()
      const tracks = events.find((event) => event.type === 'tracks')
      if (tracks === undefined || tracks.type !== 'tracks') throw new Error('expected tracks')
      expect(tracks.tracks.audio).toEqual([])
      expect(warnings.some((warning) => warning.includes('track-list'))).toBe(true)
    })
  })

  describe('end-file', () => {
    test('an eof while loading belongs to the replaced file and emits nothing', async () => {
      const { service, events, activity } = setup()
      await service.handle(LOAD)
      activity.splice(0)
      service.receive({ type: 'end-file', reason: 'eof', error: 0 })
      expect(events).toEqual([])
      expect(activity).toEqual([])
      service.receive({ type: 'file-loaded' })
      await settle()
      expect(events.length).toBe(5)
    })

    test('an error while loading is an open error; while loaded a decode error', async () => {
      const opening = setup()
      await opening.service.handle(LOAD)
      opening.service.receive({ type: 'end-file', reason: 'error', error: -13 })
      expect(opening.events).toEqual([
        { type: 'error', reason: 'open', message: PLAYER_MESSAGES.cannotOpen },
      ])

      const playing = setup()
      await playing.loaded()
      playing.clear()
      playing.service.receive({ type: 'end-file', reason: 'error', error: -13 })
      expect(playing.events).toEqual([
        { type: 'error', reason: 'decode', message: PLAYER_MESSAGES.stopped },
      ])
      expect(playing.activity).toEqual([{ isPlaying: false, isShowing: true }])
    })

    test('an eof near the end is ended; far short of a known duration it is an error', async () => {
      const near = setup()
      await near.loaded()
      near.time(118)
      near.clear()
      near.service.receive({ type: 'end-file', reason: 'eof', error: 0 })
      expect(near.events).toEqual([{ type: 'ended' }])

      const short = setup()
      await short.loaded()
      short.time(60)
      short.clear()
      short.service.receive({ type: 'end-file', reason: 'eof', error: 0 })
      expect(short.events).toEqual([
        { type: 'error', reason: 'decode', message: PLAYER_MESSAGES.stopped },
      ])

      const unknown = setup()
      unknown.mpv.values.set('duration', null)
      await unknown.loaded()
      unknown.time(60)
      unknown.clear()
      unknown.service.receive({ type: 'end-file', reason: 'eof', error: 0 })
      expect(unknown.events).toEqual([{ type: 'ended' }])
    })

    test('a refused seek puts back the time an early eof is judged by', async () => {
      const { service, mpv, events, loaded, clear, time } = setup()
      await loaded()
      time(60)
      mpv.failOn('seek')
      expect(await service.handle({ type: 'seek', time: 119 })).toEqual({
        ok: false,
        reason: 'refused',
        message: PLAYER_MESSAGES.failed,
      })
      clear()
      service.receive({ type: 'end-file', reason: 'eof', error: 0 })
      expect(events).toEqual([
        { type: 'error', reason: 'decode', message: PLAYER_MESSAGES.stopped },
      ])
    })

    test('a refused pending seek puts back the start an early eof is judged by', async () => {
      const { service, mpv, events, clear } = setup()
      await service.handle(LOAD)
      await service.handle({ type: 'seek', time: 119 })
      mpv.failOn('seek')
      service.receive({ type: 'file-loaded' })
      await settle()
      clear()
      service.receive({ type: 'end-file', reason: 'eof', error: 0 })
      expect(events).toEqual([
        { type: 'error', reason: 'decode', message: PLAYER_MESSAGES.stopped },
      ])
    })

    test('a seek to the end then an eof with no new time-pos is ended', async () => {
      const { service, events, loaded, clear, time } = setup()
      await loaded()
      time(30)
      await service.handle({ type: 'seek', time: 500 })
      clear()
      service.receive({ type: 'end-file', reason: 'eof', error: 0 })
      expect(events).toEqual([{ type: 'ended' }])
    })

    test('a load that starts near the end and ends before any time-pos is ended', async () => {
      const { service, events, loaded, clear } = setup()
      await loaded({ ...LOAD, start: 118 })
      clear()
      service.receive({ type: 'end-file', reason: 'eof', error: 0 })
      expect(events).toEqual([{ type: 'ended' }])
    })

    test('a seek sent while loading counts as the time at an early eof', async () => {
      const { service, events, clear } = setup()
      await service.handle(LOAD)
      await service.handle({ type: 'seek', time: 119 })
      service.receive({ type: 'file-loaded' })
      await settle()
      clear()
      service.receive({ type: 'end-file', reason: 'eof', error: 0 })
      expect(events).toEqual([{ type: 'ended' }])
    })

    test('a quit ending goes idle and reports activity without an event', async () => {
      const playing = setup()
      await playing.loaded()
      playing.clear()
      playing.service.receive({ type: 'end-file', reason: 'quit', error: 0 })
      expect(playing.events).toEqual([])
      expect(playing.activity).toEqual([{ isPlaying: false, isShowing: true }])
      playing.time(5)
      expect(playing.events).toEqual([])

      const opening = setup()
      await opening.service.handle(LOAD)
      opening.clear()
      opening.service.receive({ type: 'end-file', reason: 'quit', error: 0 })
      expect(opening.events).toEqual([])
      expect(opening.activity).toEqual([{ isPlaying: false, isShowing: true }])
    })

    test('a file that cannot open answers nothing more after its error', async () => {
      const { service, events, counts, mpv } = setup()
      await service.handle(LOAD)
      service.receive({ type: 'end-file', reason: 'error', error: -13 })
      service.receive({ type: 'playback-restart' })
      service.receive({ type: 'property', name: 'time-pos', data: 3 })
      service.receive({ type: 'end-file', reason: 'eof', error: 0 })
      expect(events.length).toBe(1)
      expect(counts.firstFrames).toBe(0)
      mpv.log.splice(0)
      expect(await service.handle({ type: 'audio', index: 0 })).toEqual({
        ok: false,
        reason: 'refused',
        message: PLAYER_MESSAGES.noTrack,
      })
      expect(mpv.log).toEqual([])
    })

    test('log events are warned', () => {
      const { service, warnings } = setup()
      service.receive({ type: 'log', level: 'warn', prefix: 'ffmpeg', text: 'bad packet' })
      expect(warnings).toEqual(['mpv warn ffmpeg: bad packet'])
    })
  })

  describe('commands', () => {
    test('seek clamps to 0 and the known duration', async () => {
      const { service, mpv, loaded } = setup()
      await loaded()
      mpv.log.splice(0)
      await service.handle({ type: 'seek', time: 500 })
      await service.handle({ type: 'seek', time: -4 })
      await service.handle({ type: 'seek', time: 42.5 })
      expect(mpv.log).toEqual(['seek 120 absolute', 'seek 0 absolute', 'seek 42.5 absolute'])
    })

    test('a seek while loading replaces the start and is applied at file-loaded', async () => {
      const { service, mpv } = setup()
      await service.handle(LOAD)
      mpv.log.splice(0)
      expect(await service.handle({ type: 'seek', time: 30 })).toEqual({ ok: true })
      expect(mpv.log).toEqual([])
      service.receive({ type: 'file-loaded' })
      await settle()
      expect(mpv.log).toEqual(['set aid auto', 'set sid 1', 'seek 30 absolute'])
    })

    test('a pending seek past the end is clamped to the duration read at file-loaded', async () => {
      const { service, mpv } = setup()
      await service.handle(LOAD)
      await service.handle({ type: 'seek', time: 900 })
      mpv.log.splice(0)
      service.receive({ type: 'file-loaded' })
      await settle()
      expect(mpv.log).toContain('seek 120 absolute')
    })

    test('play and pause set pause', async () => {
      const { service, mpv, loaded } = setup()
      await loaded()
      mpv.log.splice(0)
      await service.handle({ type: 'pause' })
      await service.handle({ type: 'play' })
      expect(mpv.log).toEqual(['set pause true', 'set pause false'])
    })

    test('volume, speed and subtitle scale are clamped', async () => {
      const { service, mpv } = setup()
      await service.handle({ type: 'volume', volume: 1.7, muted: false })
      await service.handle({ type: 'volume', volume: 0.1234, muted: true })
      await service.handle({ type: 'speed', rate: 9 })
      await service.handle({ type: 'speed', rate: 0.1 })
      await service.handle({ type: 'subtitleScale', scale: 7 })
      await service.handle({ type: 'subtitleScale', scale: 0 })
      expect(mpv.log).toEqual([
        'set volume 100',
        'set mute false',
        'set volume 12.3',
        'set mute true',
        'set speed 4',
        'set speed 0.25',
        'set sub-scale 3',
        'set sub-scale 0.5',
      ])
    })

    test('a number that is not finite is refused without touching mpv', async () => {
      const { service, mpv } = setup()
      expect(await service.handle({ type: 'speed', rate: Number.NaN })).toEqual({
        ok: false,
        reason: 'refused',
        message: PLAYER_MESSAGES.failed,
      })
      expect(await service.handle({ type: 'seek', time: Number.POSITIVE_INFINITY })).toEqual({
        ok: false,
        reason: 'refused',
        message: PLAYER_MESSAGES.failed,
      })
      expect(mpv.log).toEqual([])
    })

    test('volume is ignored while passthrough fixes it', async () => {
      const { service, mpv } = setup()
      await service.applyOutput({ output: PASSTHROUGH, devices: [] })
      mpv.log.splice(0)
      expect(await service.handle({ type: 'volume', volume: 0.5, muted: true })).toEqual({
        ok: true,
      })
      expect(mpv.log).toEqual([])
      await service.applyOutput({ output: PCM, devices: [] })
      mpv.log.splice(0)
      await service.handle({ type: 'volume', volume: 0.5, muted: true })
      expect(mpv.log).toEqual(['set volume 50', 'set mute true'])
    })

    test('audio by index and subtitle by id while loaded', async () => {
      const { service, mpv, loaded } = setup()
      await loaded()
      mpv.log.splice(0)
      expect(await service.handle({ type: 'audio', index: 1 })).toEqual({ ok: true })
      expect(await service.handle({ type: 'audio', index: null })).toEqual({ ok: true })
      expect(await service.handle({ type: 'subtitle', id: 'embedded-1' })).toEqual({ ok: true })
      expect(await service.handle({ type: 'subtitle', id: null })).toEqual({ ok: true })
      expect(mpv.log).toEqual(['set aid 2', 'set aid auto', 'set sid 2', 'set sid no'])
    })

    test('an audio index that is not a known whole number and an unknown subtitle are noTrack', async () => {
      const { service, mpv, loaded } = setup()
      await loaded()
      mpv.log.splice(0)
      const noTrack = { ok: false, reason: 'refused', message: PLAYER_MESSAGES.noTrack } as const
      expect(await service.handle({ type: 'audio', index: 1.5 })).toEqual(noTrack)
      expect(await service.handle({ type: 'audio', index: -1 })).toEqual(noTrack)
      expect(await service.handle({ type: 'audio', index: 2 })).toEqual(noTrack)
      expect(await service.handle({ type: 'subtitle', id: 'embedded-9' })).toEqual(noTrack)
      expect(await service.handle({ type: 'subtitle', id: 'run' })).toEqual(noTrack)
      expect(mpv.log).toEqual([])
    })

    test('track picks while loading update what file-loaded applies', async () => {
      const { service, mpv } = setup()
      await service.handle(LOAD)
      expect(await service.handle({ type: 'audio', index: 1 })).toEqual({ ok: true })
      expect(await service.handle({ type: 'subtitle', id: null })).toEqual({ ok: true })
      expect(await service.handle({ type: 'audio', index: 0.5 })).toEqual({
        ok: false,
        reason: 'refused',
        message: PLAYER_MESSAGES.noTrack,
      })
      mpv.log.splice(0)
      service.receive({ type: 'file-loaded' })
      await settle()
      expect(mpv.log).toEqual(['set aid 2', 'set sid no'])
    })

    test('stats runs the script binding; a rejecting call answers failed and is warned', async () => {
      const { service, mpv, warnings } = setup()
      expect(await service.handle({ type: 'stats' })).toEqual({ ok: true })
      expect(mpv.log).toEqual(['script-binding stats/display-stats-toggle'])
      mpv.failOn('script-binding')
      expect(await service.handle({ type: 'stats' })).toEqual({
        ok: false,
        reason: 'refused',
        message: PLAYER_MESSAGES.failed,
      })
      expect(warnings.length).toBe(1)
    })

    test('reset stops only when something is loading or loaded', async () => {
      const { service, mpv, loaded } = setup()
      await service.reset()
      expect(mpv.log).toEqual([])
      await loaded()
      mpv.log.splice(0)
      await service.reset()
      expect(mpv.log).toEqual(['stop'])
    })
  })

  describe('property events', () => {
    test('waiting is the OR of paused-for-cache and seeking, sent only on change', async () => {
      const { service, events, loaded, clear } = setup()
      await loaded()
      clear()
      service.receive({ type: 'property', name: 'paused-for-cache', data: true })
      service.receive({ type: 'property', name: 'seeking', data: true })
      service.receive({ type: 'property', name: 'paused-for-cache', data: false })
      service.receive({ type: 'property', name: 'seeking', data: false })
      expect(events).toEqual([
        { type: 'waiting', waiting: true },
        { type: 'waiting', waiting: false },
      ])
    })

    test('an unavailable paused-for-cache or seeking counts as not waiting', async () => {
      const { service, events, loaded, clear } = setup()
      await loaded()
      clear()
      service.receive({ type: 'property', name: 'seeking', data: true })
      service.receive({ type: 'property', name: 'seeking', data: null })
      service.receive({ type: 'property', name: 'paused-for-cache', data: null })
      expect(events).toEqual([
        { type: 'waiting', waiting: true },
        { type: 'waiting', waiting: false },
      ])
    })

    test('the emptied duration, tracks and frame rate of a closing file are not forwarded', async () => {
      const { service, events, loaded, clear, time } = setup()
      await loaded()
      time(60)
      clear()
      service.receive({ type: 'property', name: 'duration', data: null })
      service.receive({ type: 'property', name: 'track-list', data: [] })
      service.receive({ type: 'property', name: 'container-fps', data: null })
      expect(events).toEqual([])
      service.receive({ type: 'end-file', reason: 'eof', error: 0 })
      expect(events).toEqual([
        { type: 'error', reason: 'decode', message: PLAYER_MESSAGES.stopped },
      ])
    })

    test('a pause reads the time, since the throttle sends no trailing time-pos', async () => {
      const { service, mpv, events, loaded, clear } = setup()
      await loaded()
      clear()
      mpv.values.set('time-pos', 7.3)
      service.receive({ type: 'property', name: 'pause', data: true })
      await settle()
      expect(events).toEqual([
        { type: 'paused', paused: true },
        { type: 'time', time: 7.3 },
      ])
      expect(mpv.reads).toEqual(['time-pos'])
    })

    test('time reaches the page at most once a quarter second, with the latest trailing', async () => {
      const { service, mpv, clock, events, loaded, clear, time } = setup()
      await loaded()
      clear()
      time(1)
      time(1.1)
      mpv.values.set('time-pos', 1.2)
      Array.from({ length: 6 }).forEach((_value, index) => {
        service.receive({ type: 'property', name: 'pause', data: index % 2 === 0 })
      })
      await settle()
      expect(events.filter((event) => event.type === 'time')).toEqual([{ type: 'time', time: 1 }])
      // Six pauses and resumes in a burst: one read in flight, then one more after it.
      expect(mpv.reads).toEqual(['time-pos', 'time-pos'])
      expect(clock.pending.size).toBe(1)
      expect([...clock.pending.values()].map((timer) => timer.ms)).toEqual([TIME_MS])
      clock.fire()
      expect(events.filter((event) => event.type === 'time')).toEqual([
        { type: 'time', time: 1 },
        { type: 'time', time: 1.2 },
      ])
      clock.fire()
      expect(events.filter((event) => event.type === 'time').length).toBe(2)
    })

    test('a time held for the window is dropped when a seek is sent', async () => {
      const { service, clock, events, loaded, clear, time } = setup()
      await loaded()
      clear()
      time(1)
      time(2)
      await service.handle({ type: 'seek', time: 90 })
      clock.fire()
      expect(events).toEqual([{ type: 'time', time: 1 }])
    })

    test('a time read older than the time already shown is dropped', async () => {
      const { service, mpv, clock, events, loaded, clear, time } = setup()
      await loaded()
      clear()
      time(10)
      mpv.values.set('time-pos', 9.9)
      service.receive({ type: 'playback-restart' })
      await settle()
      clock.fire()
      expect(events).toEqual([{ type: 'time', time: 10 }])
    })

    test('a seek back lets the next read show an earlier time', async () => {
      const { service, mpv, clock, events, loaded, clear, time } = setup()
      await loaded()
      clear()
      time(10)
      clock.fire()
      await service.handle({ type: 'seek', time: 4 })
      mpv.values.set('time-pos', 4)
      service.receive({ type: 'playback-restart' })
      await settle()
      expect(events).toEqual([
        { type: 'time', time: 10 },
        { type: 'time', time: 4 },
      ])
    })

    test('a time read overtaken by a seek is dropped and read again after it', async () => {
      const { service, mpv, events, loaded, clear } = setup()
      await loaded()
      clear()
      mpv.hold('read time-pos')
      mpv.values.set('time-pos', 30)
      service.receive({ type: 'playback-restart' })
      await settle()
      await service.handle({ type: 'seek', time: 5 })
      service.receive({ type: 'playback-restart' })
      mpv.release()
      mpv.hold('read time-pos')
      await settle()
      expect(events).toEqual([])
      expect(mpv.reads).toEqual(['time-pos', 'time-pos'])
      mpv.values.set('time-pos', 5)
      mpv.release()
      await settle()
      expect(events).toEqual([{ type: 'time', time: 5 }])
    })

    test('a time held for the window is dropped when the file is stopped', async () => {
      const { service, clock, events, loaded, clear, time } = setup()
      await loaded()
      clear()
      time(1)
      time(2)
      await service.handle({ type: 'stop' })
      clock.fire()
      expect(events).toEqual([{ type: 'time', time: 1 }])
    })

    test('time, duration, speed, pause and tracks are forwarded while loaded', async () => {
      const { service, events, activity, loaded, clear, time } = setup()
      await loaded()
      clear()
      time(12)
      time(null)
      service.receive({ type: 'property', name: 'duration', data: 130 })
      service.receive({ type: 'property', name: 'speed', data: 1.5 })
      service.receive({ type: 'property', name: 'pause', data: true })
      service.receive({ type: 'property', name: 'container-fps', data: 25 })
      expect(events.slice(0, 4)).toEqual([
        { type: 'time', time: 12 },
        { type: 'duration', duration: 130 },
        { type: 'rate', rate: 1.5 },
        { type: 'paused', paused: true },
      ])
      const tracks = events[4]
      if (tracks === undefined || tracks.type !== 'tracks') throw new Error('expected tracks')
      expect(tracks.tracks.frameRate).toBe(25)
      expect(activity).toEqual([{ isPlaying: false, isShowing: true }])
    })

    test('buffered is throttled to one a second with the latest ranges trailing', async () => {
      const { events, clock, loaded, clear, ranges } = setup()
      await loaded()
      clear()
      Array.from({ length: 12 }, (_, index) => index).forEach((index) =>
        ranges([{ start: 0, end: 10 + index }]),
      )
      expect(events).toEqual([{ type: 'buffered', ranges: [{ start: 0, end: 10 }] }])
      expect([...clock.pending.values()].map((timer) => timer.ms)).toEqual([BUFFERED_MS])
      clock.fire()
      expect(events).toEqual([
        { type: 'buffered', ranges: [{ start: 0, end: 10 }] },
        { type: 'buffered', ranges: [{ start: 0, end: 21 }] },
      ])
      ranges([{ start: 0, end: 21.2 }])
      clock.fire()
      ranges([{ start: 0, end: 21.3 }])
      clock.fire()
      expect(events.length).toBe(2)
      ranges([{ start: 0, end: 22 }])
      expect(events.length).toBe(3)
    })

    test('a range that appears or goes counts as moved, and a null cache state is no ranges', async () => {
      const { service, events, clock, loaded, clear, ranges } = setup()
      await loaded()
      clear()
      ranges([{ start: 0, end: 10 }])
      clock.fire()
      ranges([
        { start: 0, end: 10 },
        { start: 50, end: 60 },
      ])
      clock.fire()
      service.receive({ type: 'property', name: 'demuxer-cache-state', data: null })
      expect(events.map((event) => (event.type === 'buffered' ? event.ranges.length : -1))).toEqual(
        [1, 2, 0],
      )
    })
  })

  describe('engine', () => {
    test('shutdown emits one engine error and later commands answer engineStopped', async () => {
      const { service, mpv, events, loaded, clear } = setup()
      await loaded()
      clear()
      expect(service.isDead()).toBe(false)
      service.receive({ type: 'shutdown' })
      expect(service.isDead()).toBe(true)
      service.receive({ type: 'overflow' })
      service.receive({ type: 'error', message: 'Invalid native mpv event' })
      expect(events).toEqual([
        { type: 'error', reason: 'engine', message: PLAYER_MESSAGES.engineStopped },
      ])
      const stopped = {
        ok: false,
        reason: 'engine',
        message: PLAYER_MESSAGES.engineStopped,
      } as const
      expect(await service.handle(LOAD)).toEqual(stopped)
      expect(await service.handle({ type: 'play' })).toEqual(stopped)
      await service.reset()
      await service.applyOutput({ output: PCM, devices: [] })
      await service.applyDisplay({ refreshRate: 60, edrHeadroom: 1 })
      service.receive({ type: 'file-loaded' })
      await settle()
      expect(mpv.log).toEqual([])
      expect(events.length).toBe(1)
    })

    test('a shutdown while a command is in flight answers engineStopped', async () => {
      const { service, mpv, loaded } = setup()
      await loaded()
      mpv.hold()
      const answer = service.handle({ type: 'pause' })
      mpv.shutdown()
      expect(await answer).toEqual({
        ok: false,
        reason: 'engine',
        message: PLAYER_MESSAGES.engineStopped,
      })
    })

    test('a destroy while a command is in flight answers failed and is warned', async () => {
      const { service, mpv, warnings, loaded } = setup()
      await loaded()
      mpv.hold()
      const answer = service.handle({ type: 'seek', time: 20 })
      mpv.destroy()
      expect(await answer).toEqual({
        ok: false,
        reason: 'refused',
        message: PLAYER_MESSAGES.failed,
      })
      expect(warnings.some((warning) => warning.includes('mpv is destroyed'))).toBe(true)
      expect(await service.handle({ type: 'play' })).toEqual({
        ok: false,
        reason: 'refused',
        message: PLAYER_MESSAGES.failed,
      })
    })
  })

  describe('activity and first frame', () => {
    test('load, an unpaused file-loaded, pause and stop report activity in order', async () => {
      const { service, activity, mpv } = setup()
      await service.handle(LOAD)
      service.receive({ type: 'file-loaded' })
      await settle()
      service.receive({ type: 'property', name: 'pause', data: true })
      mpv.log.splice(0)
      await service.handle({ type: 'stop' })
      expect(mpv.log).toEqual(['stop'])
      expect(activity).toEqual([
        { isPlaying: false, isShowing: true },
        { isPlaying: true, isShowing: true },
        { isPlaying: false, isShowing: true },
        { isPlaying: false, isShowing: false },
      ])
    })

    test('the first playback-restart after each load is the first frame', async () => {
      const { service, counts, loaded } = setup()
      await loaded()
      service.receive({ type: 'playback-restart' })
      service.receive({ type: 'playback-restart' })
      expect(counts.firstFrames).toBe(1)
      await loaded()
      service.receive({ type: 'playback-restart' })
      expect(counts.firstFrames).toBe(2)
    })

    test('a playback-restart reads the time, so a second paused seek reports where it landed', async () => {
      const { service, mpv, clock, events, loaded, clear } = setup()
      await loaded()
      mpv.values.set('time-pos', 5)
      service.receive({ type: 'property', name: 'pause', data: true })
      await settle()
      clock.fire()
      clear()
      await service.handle({ type: 'seek', time: 10 })
      mpv.values.set('time-pos', 10)
      service.receive({ type: 'playback-restart' })
      await settle()
      await service.handle({ type: 'seek', time: 20 })
      mpv.values.set('time-pos', 20)
      service.receive({ type: 'playback-restart' })
      await settle()
      expect(events).toEqual([{ type: 'time', time: 10 }])
      // Inside the quarter second, so the second lands when the window closes.
      clock.fire()
      expect(events).toEqual([
        { type: 'time', time: 10 },
        { type: 'time', time: 20 },
      ])
      expect(mpv.reads).toEqual(['time-pos', 'time-pos'])
    })

    test('callbacks that throw never break the events after them', async () => {
      const mpv = createFakeMpv()
      const events: PlayerEvent[] = []
      const service = createPlayerService({
        mpv: mpv.control,
        resolveSource: resolveSourceWith({ grants: { fileOf } }),
        canChooseAo: false,
        timers: createFakeTimers().timers,
        onActivity: () => {
          throw new Error('activity')
        },
        onFirstFrame: () => {
          throw new Error('first frame')
        },
        warn: () => {
          throw new Error('warn')
        },
      })
      service.subscribe((event) => {
        events.push(event)
      })
      expect(await service.handle(LOAD)).toEqual({ ok: true })
      service.receive({ type: 'file-loaded' })
      await settle()
      expect(() => {
        service.receive({ type: 'playback-restart' })
        service.receive({ type: 'log', level: 'warn', prefix: 'ffmpeg', text: 'bad' })
        service.receive({ type: 'property', name: 'pause', data: true })
        service.receive({ type: 'property', name: 'time-pos', data: 7 })
      }).not.toThrow()
      expect(events.slice(-2)).toEqual([
        { type: 'paused', paused: true },
        { type: 'time', time: 7 },
      ])
    })

    test('a listener that unsubscribes hears nothing more', async () => {
      const { service, time, loaded } = setup()
      await loaded()
      const heard: PlayerEvent[] = []
      const unsubscribe = service.subscribe((event) => {
        heard.push(event)
      })
      time(1)
      unsubscribe()
      time(2)
      expect(heard).toEqual([{ type: 'time', time: 1 }])
    })
  })

  describe('races', () => {
    test('a reset while the load waits on mpv sends no loadfile after the stop', async () => {
      const { service, mpv, activity } = setup()
      mpv.hold()
      const loading = service.handle(LOAD)
      await settle()
      const resetting = service.reset()
      await settle()
      mpv.release()
      await settle()
      expect(await loading).toEqual({ ok: true })
      await resetting
      expect(mpv.log).toEqual(['set pause false', 'stop'])
      expect(activity.at(-1)).toEqual({ isPlaying: false, isShowing: false })
      await service.reset()
      expect(mpv.log).toEqual(['set pause false', 'stop'])
    })

    test('an engine shutdown landing with the pause reply makes the load answer engineStopped', async () => {
      const { service, mpv } = setup()
      mpv.hold('set pause')
      const loading = service.handle(LOAD)
      await settle()
      mpv.release()
      service.receive({ type: 'shutdown' })
      expect(await loading).toEqual({
        ok: false,
        reason: 'engine',
        message: PLAYER_MESSAGES.engineStopped,
      })
      expect(mpv.log).toEqual(['set pause false'])
    })

    test('an overflow landing with the pause reply makes the load answer engineStopped', async () => {
      const { service, mpv } = setup()
      mpv.hold('set pause')
      const loading = service.handle(LOAD)
      await settle()
      mpv.release()
      service.receive({ type: 'overflow' })
      expect(await loading).toEqual({
        ok: false,
        reason: 'engine',
        message: PLAYER_MESSAGES.engineStopped,
      })
      expect(mpv.log).toEqual(['set pause false'])
    })

    test('an engine stop landing with the loadfile reply makes the load answer engineStopped', async () => {
      const { service, mpv } = setup()
      mpv.hold('loadfile')
      const loading = service.handle(LOAD)
      await settle()
      mpv.release()
      service.receive({ type: 'shutdown' })
      expect(await loading).toEqual({
        ok: false,
        reason: 'engine',
        message: PLAYER_MESSAGES.engineStopped,
      })
    })

    test('a track pick overtaken by an engine stop answers engineStopped', async () => {
      const { service, mpv, loaded } = setup()
      await loaded()
      mpv.hold('set')
      const audio = service.handle({ type: 'audio', index: 1 })
      const subtitle = service.handle({ type: 'subtitle', id: 'embedded-1' })
      await settle()
      mpv.release()
      service.receive({ type: 'error', message: 'Invalid native mpv event' })
      const stopped = {
        ok: false,
        reason: 'engine',
        message: PLAYER_MESSAGES.engineStopped,
      } as const
      expect(await audio).toEqual(stopped)
      expect(await subtitle).toEqual(stopped)
    })

    test('an audio pick overtaken by a new load does not change what the new load wants', async () => {
      const { service, mpv, loaded } = setup()
      await loaded()
      mpv.hold('set aid')
      const picking = service.handle({ type: 'audio', index: 1 })
      await service.handle({ ...LOAD, audio: null })
      mpv.release()
      expect(await picking).toEqual({ ok: true })
      mpv.log.splice(0)
      service.receive({ type: 'file-loaded' })
      await settle()
      expect(mpv.log).toEqual(['set aid auto', 'set sid 1'])
    })

    test('a subtitle pick overtaken by a new load does not change what the new load wants', async () => {
      const { service, mpv, loaded } = setup()
      await loaded()
      mpv.hold('set sid')
      const picking = service.handle({ type: 'subtitle', id: 'embedded-1' })
      await service.handle({ ...LOAD, subtitle: null })
      mpv.release()
      expect(await picking).toEqual({ ok: true })
      mpv.log.splice(0)
      service.receive({ type: 'file-loaded' })
      await settle()
      expect(mpv.log).toEqual(['set aid auto', 'set sid no'])
    })

    test('events before the loadfile reply belong to the replaced file, even after it was sent', async () => {
      const { service, mpv, events, activity, loaded, clear } = setup()
      await loaded()
      clear()
      mpv.hold('loadfile')
      const loading = service.handle(LOAD)
      await settle()
      expect(mpv.log).toEqual(['set pause false', 'loadfile /m/Film.mkv replace -1 start=0'])
      activity.splice(0)
      service.receive({ type: 'file-loaded' })
      service.receive({ type: 'property', name: 'time-pos', data: 4 })
      service.receive({ type: 'end-file', reason: 'error', error: -13 })
      service.receive({ type: 'end-file', reason: 'redirect', error: 0 })
      await settle()
      expect(events).toEqual([])
      expect(activity).toEqual([])
      mpv.release()
      expect(await loading).toEqual({ ok: true })
      service.receive({ type: 'file-loaded' })
      await settle()
      expect(events.map((event) => event.type)).toEqual([
        'paused',
        'duration',
        'rate',
        'waiting',
        'tracks',
      ])
    })

    test('a redirect while loaded is fatal too: an open error, and mpv stops', async () => {
      const { service, mpv, events, loaded, clear } = setup()
      await loaded()
      clear()
      service.receive({ type: 'end-file', reason: 'redirect', error: 0 })
      expect(events).toEqual([
        { type: 'error', reason: 'open', message: PLAYER_MESSAGES.cannotOpen },
      ])
      expect(mpv.log).toEqual(['stop'])
      service.receive({ type: 'file-loaded' })
      await settle()
      expect(events.length).toBe(1)
    })

    test('a redirect before the loadfile is sent is the replaced file and ignored', async () => {
      const { service, mpv, types, activity } = setup()
      mpv.hold('set pause')
      const loading = service.handle(LOAD)
      await settle()
      activity.splice(0)
      service.receive({ type: 'end-file', reason: 'redirect', error: 0 })
      mpv.release()
      expect(await loading).toEqual({ ok: true })
      expect(types()).toEqual([])
      expect(activity).toEqual([])
      service.receive({ type: 'file-loaded' })
      await settle()
      expect(types()).toEqual(['paused', 'duration', 'rate', 'waiting', 'tracks'])
    })

    test('a redirect after the loadfile is a playlist: an open error, and mpv stops', async () => {
      const { service, mpv, events, activity, warnings } = setup()
      await service.handle(LOAD)
      mpv.log.splice(0)
      activity.splice(0)
      service.receive({ type: 'end-file', reason: 'redirect', error: 0 })
      expect(events).toEqual([
        { type: 'error', reason: 'open', message: PLAYER_MESSAGES.cannotOpen },
      ])
      expect(activity).toEqual([{ isPlaying: false, isShowing: true }])
      expect(mpv.log).toEqual(['stop'])
      expect(warnings).toEqual(['mpv opened a playlist, which raven player does not follow'])
      service.receive({ type: 'file-loaded' })
      await settle()
      expect(events.length).toBe(1)
    })

    test('a failing stop after a playlist is only warned', async () => {
      const { service, mpv, warnings } = setup()
      await service.handle(LOAD)
      mpv.failOn('stop')
      service.receive({ type: 'end-file', reason: 'redirect', error: 0 })
      await settle()
      expect(warnings.at(-1)).toBe('mpv stop failed: mpv request failed (-12)')
    })

    test('a file-loaded from the replaced file while the load waits on mpv still sends the loadfile', async () => {
      const { service, mpv, events, loaded, clear } = setup()
      await loaded()
      clear()
      mpv.hold('set pause')
      const loading = service.handle(LOAD)
      await settle()
      service.receive({ type: 'file-loaded' })
      service.receive({ type: 'property', name: 'time-pos', data: 4 })
      mpv.release()
      expect(await loading).toEqual({ ok: true })
      await settle()
      expect(mpv.log).toEqual(['set pause false', 'loadfile /m/Film.mkv replace -1 start=0'])
      expect(events).toEqual([])
    })

    test('a stale file-loaded re-arms the first frame for the file that replaces it', async () => {
      const { service, counts } = setup()
      await service.handle(LOAD)
      service.receive({ type: 'file-loaded' })
      await settle()
      service.receive({ type: 'playback-restart' })
      expect(counts.firstFrames).toBe(1)
      service.receive({ type: 'end-file', reason: 'stop', error: 0 })
      service.receive({ type: 'file-loaded' })
      await settle()
      service.receive({ type: 'playback-restart' })
      expect(counts.firstFrames).toBe(2)
    })

    test('late events after stop reach nothing', async () => {
      const { service, mpv, events, activity, counts, loaded, clear, time } = setup()
      await loaded()
      await service.handle({ type: 'stop' })
      clear()
      time(50)
      service.receive({ type: 'property', name: 'pause', data: true })
      service.receive({ type: 'end-file', reason: 'stop', error: 0 })
      service.receive({ type: 'end-file', reason: 'eof', error: 0 })
      service.receive({ type: 'file-loaded' })
      service.receive({ type: 'playback-restart' })
      await settle()
      expect(events).toEqual([])
      expect(activity).toEqual([])
      expect(mpv.log).toEqual([])
      expect(mpv.reads).toEqual([])
      expect(counts.firstFrames).toBe(0)
    })

    test('a repeated load drops the replaced file and judges eof by the new one', async () => {
      const { service, mpv, events, loaded, clear, time } = setup()
      await loaded()
      time(50)
      await service.handle(LOAD)
      clear()
      time(51)
      service.receive({ type: 'end-file', reason: 'stop', error: 0 })
      expect(events).toEqual([])
      mpv.values.set('duration', 300)
      service.receive({ type: 'file-loaded' })
      await settle()
      expect(events.length).toBe(5)
      time(298)
      clear()
      service.receive({ type: 'end-file', reason: 'eof', error: 0 })
      expect(events).toEqual([{ type: 'ended' }])
    })

    test('a file-loaded from the replaced file is superseded by the new one', async () => {
      const { service, events, types, loaded, clear, time } = setup()
      await service.handle(LOAD)
      await loaded()
      clear()
      service.receive({ type: 'end-file', reason: 'stop', error: 0 })
      time(3)
      service.receive({ type: 'file-loaded' })
      await settle()
      expect(types()).toEqual(['time', 'paused', 'duration', 'rate', 'waiting', 'tracks'])
      time(119)
      clear()
      service.receive({ type: 'end-file', reason: 'eof', error: 0 })
      expect(events).toEqual([{ type: 'ended' }])
    })

    test('a stop while the snapshot is being read emits no snapshot', async () => {
      const { service, mpv, events, activity, clear } = setup()
      await service.handle(LOAD)
      clear()
      mpv.hold()
      service.receive({ type: 'file-loaded' })
      const stopped = service.handle({ type: 'stop' })
      mpv.release()
      await settle()
      mpv.release()
      await settle()
      mpv.release()
      await settle()
      expect(await stopped).toEqual({ ok: true })
      expect(events).toEqual([])
      expect(activity).toEqual([{ isPlaying: false, isShowing: false }])
    })

    test('a stop after the last snapshot read was sent still emits no snapshot', async () => {
      const { service, mpv, events, clear } = setup()
      await service.handle(LOAD)
      clear()
      mpv.hold('read speed')
      service.receive({ type: 'file-loaded' })
      await settle()
      expect(mpv.reads.at(-1)).toBe('speed')
      await service.handle({ type: 'stop' })
      mpv.release()
      await settle()
      expect(events).toEqual([])
    })

    test('a load while the snapshot is being read leaves one snapshot for the new load', async () => {
      const { service, mpv, types, clear } = setup()
      await service.handle(LOAD)
      clear()
      mpv.hold()
      service.receive({ type: 'file-loaded' })
      const reloaded = service.handle(LOAD)
      mpv.release()
      await settle()
      expect(await reloaded).toEqual({ ok: true })
      await settle()
      expect(types()).toEqual([])
      service.receive({ type: 'file-loaded' })
      await settle()
      expect(types()).toEqual(['paused', 'duration', 'rate', 'waiting', 'tracks'])
    })

    test('events behind a refused loadfile reply belong to no load', async () => {
      const { service, mpv, events } = setup()
      mpv.hold('loadfile')
      mpv.failOn('loadfile')
      const loading = service.handle(LOAD)
      await settle()
      mpv.release()
      service.receive({ type: 'file-loaded' })
      expect(await loading).toEqual({
        ok: false,
        reason: 'refused',
        message: PLAYER_MESSAGES.failed,
      })
      await settle()
      expect(mpv.reads).toEqual([])
      expect(events).toEqual([])
    })

    test('an older loadfile reply never takes back the newer load it was overtaken by', async () => {
      const { service, mpv, types } = setup()
      mpv.hold('loadfile')
      const first = service.handle(LOAD)
      await settle()
      const second = service.handle(LOAD)
      await settle()
      expect(mpv.log.filter((entry) => entry.startsWith('loadfile'))).toHaveLength(2)
      mpv.releaseNewestFirst()
      expect(await second).toEqual({ ok: true })
      expect(await first).toEqual({ ok: true })
      service.receive({ type: 'file-loaded' })
      await settle()
      expect(types()).toEqual(['paused', 'duration', 'rate', 'waiting', 'tracks'])
    })

    test('a buffered trailing timer from a replaced load is cancelled', async () => {
      const { service, events, clock, loaded, clear, ranges } = setup()
      await loaded()
      ranges([{ start: 0, end: 10 }])
      ranges([{ start: 0, end: 20 }])
      await service.handle(LOAD)
      clear()
      clock.fire()
      expect(events).toEqual([])
      expect(clock.pending.size).toBe(0)
    })
  })

  describe('output and display', () => {
    test('applyOutput sets each option in order and reloads audio only while loaded', async () => {
      const { service, mpv, loaded } = setup()
      await service.applyOutput({ output: PCM, devices: [] })
      expect(mpv.log).toEqual([
        'set audio-device auto',
        'set audio-spdif ',
        'set audio-channels auto-safe',
        'set audio-exclusive false',
        'set audio-normalize-downmix false',
      ])
      await loaded()
      mpv.log.splice(0)
      await service.applyOutput({ output: PCM, devices: [] })
      expect(mpv.log.at(-1)).toBe('ao-reload')
    })

    test('a failing ao-reload or option is only warned', async () => {
      const { service, mpv, warnings, loaded } = setup()
      await loaded()
      mpv.failOn('ao-reload')
      mpv.failOn('set audio-spdif')
      await service.applyOutput({ output: PCM, devices: [] })
      expect(mpv.log).toContain('set audio-normalize-downmix false')
      expect(warnings.length).toBe(2)
    })

    test('applyDisplay sets the display options', async () => {
      const { service, mpv } = setup()
      await service.applyDisplay({ refreshRate: 120, edrHeadroom: 2 })
      expect(mpv.log).toEqual(['set display-fps-override 120', 'set target-colorspace-hint yes'])
    })
  })
})
