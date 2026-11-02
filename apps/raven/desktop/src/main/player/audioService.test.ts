import { describe, expect, test } from 'bun:test'
import {
  AUDIO_COMMANDS,
  AUDIO_EVENTS,
  type AudioEvent,
  DESKTOP_PLATFORMS,
  ENGINE_STOPPED,
  EQ_BANDS,
  EQ_PRESETS,
  type OutputSettings,
  PLAYER_ERROR_REASONS,
  PLAYER_REFUSAL_REASONS,
  PLAYER_SOURCE_KINDS,
  REMOTE_COMMANDS,
} from '@raven/core'
import {
  MPV_COMMANDS,
  MPV_END_FILE_REASONS,
  MPV_EVENTS,
  MPV_PROPERTIES,
  type MpvEvent,
  type MpvProperty,
  type NowPlaying,
} from '@raven/mpv'
import {
  AUDIO_OBSERVED,
  type AudioMpv,
  createAudioService,
  soundFilterOf,
} from '@/main/player/audioService'
import { HARDENED_OPTIONS } from '@/main/player/engine'
import type { FailureExplainer, ResolvedSource, ServerTarget } from '@/main/player/loadTarget'
import { PLAYER_MESSAGES } from '@/main/player/playerMessages'

const SERVER_ID = '00000000-0000-4000-8000-000000000001'
const BASE = 'http://127.0.0.1:41234'

const targetOf = (mediaId: number): ServerTarget => ({
  kind: PLAYER_SOURCE_KINDS.server,
  serverId: SERVER_ID,
  mediaId,
  url: `${BASE}/secret-${mediaId}/file`,
  sidecars: [],
  relay: { loadId: String(mediaId), base: `${BASE}/secret-${mediaId}` },
})

/** Track 404 is on no server; a downloaded one plays its file; every other id resolves through the fake relay. */
const GONE = 404
const fileOf = (mediaId: number) => `/Users/me/raven/downloads/${mediaId}/media.flac`
const GONE_MESSAGE = 'This title is not on Vhagar any more.'
const LOCKED = { reason: PLAYER_ERROR_REASONS.locked, message: 'Vhagar locked this library again.' }
const PCM: OutputSettings = { profile: 'pcm', device: 'auto', passthrough: [], spatial: false }

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

type FakeReadProps<K extends MpvProperty> = { name: K }

/**
 * A scripted mpv: every call is logged and answers at once, unless its prefix is set to fail,
 * or held until `hold`'s release.
 */
const fakeMpv = () => {
  const log: string[] = []
  const shown: (NowPlaying | null)[] = []
  const observed: string[] = []
  const failing = new Set<string>()
  const holds = new Map<string, Promise<void>>()
  const sink: { receive: (event: MpvEvent) => void } = { receive: () => {} }
  const hold = (prefix: string) => {
    const { promise, resolve } = Promise.withResolvers<void>()
    holds.set(prefix, promise)
    return () => {
      holds.delete(prefix)
      resolve()
    }
  }
  const reply = async (entry: string) => {
    log.push(entry)
    const held = [...holds].find(([prefix]) => entry.startsWith(prefix))
    if (held !== undefined) await held[1]
    if ([...failing].some((prefix) => entry.startsWith(prefix))) {
      throw new Error('mpv request failed (-12)')
    }
  }
  const mpv: AudioMpv = {
    command: ({ args }) => reply(args.join(' ')),
    set: ({ name, value }) => reply(`set ${name} ${String(value)}`),
    read: async <K extends MpvProperty>({ name }: FakeReadProps<K>) => {
      throw new Error(`unexpected read of ${name}`)
    },
    observe: ({ name }) => {
      observed.push(name)
    },
    nowPlaying: (info) => {
      shown.push(info)
    },
    clearNowPlaying: () => {
      shown.push(null)
    },
  }
  return {
    mpv,
    log,
    shown,
    observed,
    failing,
    hold,
    connect: (receive: (event: MpvEvent) => void) => {
      sink.receive = receive
    },
    emit: (event: MpvEvent) => sink.receive(event),
  }
}

type SetupProps = { explain?: FailureExplainer; downloaded?: readonly number[] }

const setup = ({ explain = async () => LOCKED, downloaded = [] }: SetupProps = {}) => {
  const fake = fakeMpv()
  const resolved: number[] = []
  const bitrates: (number | null)[] = []
  const closed: string[] = []
  const playing: boolean[] = []
  const warnings: string[] = []
  const events: AudioEvent[] = []
  const service = createAudioService({
    mpv: fake.mpv,
    resolve: async ({ mediaId, kbps }): Promise<ResolvedSource> => {
      resolved.push(mediaId)
      bitrates.push(kbps)
      if (mediaId === GONE) return { ok: false, message: GONE_MESSAGE }
      if (downloaded.includes(mediaId)) {
        return {
          ok: true,
          target: { kind: PLAYER_SOURCE_KINDS.file, path: fileOf(mediaId), sidecars: [] },
        }
      }
      return { ok: true, target: targetOf(mediaId) }
    },
    explain,
    closeLoad: (target) => {
      closed.push(target.relay.loadId)
    },
    canChooseAo: true,
    platform: DESKTOP_PLATFORMS.mac,
    onPlaying: (isPlaying) => {
      playing.push(isPlaying)
    },
    warn: (message) => {
      warnings.push(message)
    },
  })
  fake.connect(service.receive)
  service.subscribe((event) => {
    events.push(event)
  })
  return {
    service,
    fake,
    shown: fake.shown,
    resolved,
    bitrates,
    closed,
    playing,
    warnings,
    events,
  }
}

const LOAD = {
  type: AUDIO_COMMANDS.load,
  mediaId: 7,
  level: 1,
  next: { mediaId: 8, level: 1, kbps: null },
  start: 0,
  kbps: null,
} as const

/** Queues `mediaId` at level 1 from its file, or clears what is queued for null. */
const queueOf = (mediaId: number | null) =>
  ({
    type: AUDIO_COMMANDS.queueNext,
    next: mediaId === null ? null : { mediaId, level: 1, kbps: null },
  }) as const

type LoadfileOfProps = { mediaId: number; mode: string; start: number; filter?: string }

/** A `loadfile` as the fake logs it, its `af` quoted with mpv's byte count. */
const loadfileOf = ({ mediaId, mode, start, filter = '' }: LoadfileOfProps) =>
  `loadfile ${BASE}/secret-${mediaId}/file ${mode} -1 start=${start},stream-lavf-o=%37%max_redirects=0,reconnect_delay_max=3,network-timeout=15,replaygain=no,af=%${filter.length}%${filter}`

describe('loading', () => {
  test('hardens mpv first and follows the four properties', async () => {
    const { fake } = setup()
    await settle()
    expect(fake.observed).toEqual([...AUDIO_OBSERVED])
    expect(fake.log).toEqual(
      HARDENED_OPTIONS.map(({ name, value }) => `set ${name} ${String(value)}`),
    )
  })

  test('plays the track and queues the next behind it for mpv to run on to', async () => {
    const { service, fake, resolved } = setup()
    await settle()
    fake.log.length = 0
    expect(await service.handle(LOAD)).toEqual({ ok: true })
    expect(resolved).toEqual([7, 8])
    expect(fake.log).toEqual([
      'set pause false',
      loadfileOf({ mediaId: 7, mode: 'replace', start: 0 }),
      `${MPV_COMMANDS.playlistClear}`,
      loadfileOf({ mediaId: 8, mode: 'append-play', start: 0 }),
    ])
  })

  test('a load fetches at its bitrate, and a queued track at its own, queued again only when it changes', async () => {
    const { service, resolved, bitrates } = setup()
    await settle()
    await service.handle({ ...LOAD, kbps: 256, next: { ...LOAD.next, kbps: 256 } })
    const at320 = {
      type: AUDIO_COMMANDS.queueNext,
      next: { mediaId: 9, level: 1, kbps: 320 },
    } as const
    await service.handle(at320)
    await service.handle(at320)
    await service.handle({ ...at320, next: { ...at320.next, kbps: 128 } })
    await service.handle(LOAD)
    expect(resolved).toEqual([7, 8, 9, 9, 7, 8])
    expect(bitrates).toEqual([256, 256, 320, 128, null, null])
  })

  test('a track the server refuses is refused with its words, and nothing is sent', async () => {
    const { service, fake } = setup()
    await settle()
    fake.log.length = 0
    expect(await service.handle({ ...LOAD, mediaId: GONE })).toEqual({
      ok: false,
      reason: PLAYER_REFUSAL_REASONS.refused,
      message: GONE_MESSAGE,
    })
    expect(fake.log).toEqual([])
  })

  test('a failed hardening refuses every load', async () => {
    const fake = fakeMpv()
    fake.failing.add(`set ${HARDENED_OPTIONS[0].name}`)
    const service = createAudioService({
      mpv: fake.mpv,
      resolve: async ({ mediaId }) => ({ ok: true, target: targetOf(mediaId) }),
      explain: async () => LOCKED,
      closeLoad: () => {},
      canChooseAo: true,
      platform: DESKTOP_PLATFORMS.mac,
      onPlaying: () => {},
      warn: () => {},
    })
    await settle()
    expect(await service.handle(LOAD)).toEqual({
      ok: false,
      reason: PLAYER_REFUSAL_REASONS.refused,
      message: PLAYER_MESSAGES.failed,
    })
  })

  test('a newer load retires what the last one opened', async () => {
    const { service, closed } = setup()
    await service.handle(LOAD)
    await service.handle({ ...LOAD, mediaId: 9, next: null })
    expect(closed).toEqual(['7', '8'])
  })
})

describe('what follows', () => {
  test('queueNext replaces the queued track, clears it for null, and leaves a repeat alone', async () => {
    const { service, fake, closed, resolved } = setup()
    await service.handle(LOAD)
    fake.log.length = 0
    expect(await service.handle(queueOf(8))).toEqual({ ok: true })
    expect(fake.log).toEqual([])
    expect(await service.handle(queueOf(9))).toEqual({ ok: true })
    expect(closed).toEqual(['8'])
    expect(fake.log).toEqual([
      MPV_COMMANDS.playlistClear,
      loadfileOf({ mediaId: 9, mode: 'append-play', start: 0 }),
    ])
    fake.log.length = 0
    expect(await service.handle(queueOf(null))).toEqual({
      ok: true,
    })
    expect(closed).toEqual(['8', '9'])
    expect(fake.log).toEqual([MPV_COMMANDS.playlistClear])
    expect(resolved).toEqual([7, 8, 9])
  })

  test('an append mpv refuses leaves nothing queued, so the next end is a plain ended', async () => {
    const { service, fake, events, closed } = setup()
    await service.handle({ ...LOAD, next: null })
    fake.failing.add(`loadfile ${BASE}/secret-8/file append-play`)
    expect(await service.handle(queueOf(8))).toEqual({
      ok: false,
      reason: PLAYER_REFUSAL_REASONS.refused,
      message: PLAYER_MESSAGES.failed,
    })
    expect(closed).toEqual(['8'])
    fake.emit({ type: MPV_EVENTS.endFile, reason: MPV_END_FILE_REASONS.eof, error: 0 })
    expect(events).toEqual([{ type: AUDIO_EVENTS.ended }])
  })

  test('a next track the server refuses is refused with its words', async () => {
    const { service } = setup()
    await service.handle({ ...LOAD, next: null })
    expect(await service.handle(queueOf(GONE))).toEqual({
      ok: false,
      reason: PLAYER_REFUSAL_REASONS.refused,
      message: GONE_MESSAGE,
    })
  })

  test('queueNext while nothing plays does nothing', async () => {
    const { service, fake } = setup()
    await settle()
    fake.log.length = 0
    expect(await service.handle(queueOf(8))).toEqual({ ok: true })
    expect(fake.log).toEqual([])
  })

  test('when the track ends with one queued, mpv has moved on and the page hears advanced', async () => {
    const { service, fake, events, closed } = setup()
    await service.handle(LOAD)
    fake.emit({ type: MPV_EVENTS.fileLoaded })
    fake.emit({ type: MPV_EVENTS.endFile, reason: MPV_END_FILE_REASONS.eof, error: 0 })
    expect(events).toEqual([{ type: AUDIO_EVENTS.advanced }])
    expect(closed).toEqual(['7'])
    // The page now names what follows the new track; the old next is what plays.
    fake.log.length = 0
    await service.handle(queueOf(9))
    expect(fake.log).toEqual([
      MPV_COMMANDS.playlistClear,
      loadfileOf({ mediaId: 9, mode: 'append-play', start: 0 }),
    ])
  })

  test('an end while the queue clears is an advance onto what was queued, which stays open', async () => {
    const { service, fake, events, closed } = setup()
    await service.handle(LOAD)
    fake.emit({ type: MPV_EVENTS.fileLoaded })
    const release = fake.hold(MPV_COMMANDS.playlistClear)
    fake.log.length = 0
    const queuing = service.handle(queueOf(9))
    await settle()
    fake.emit({ type: MPV_EVENTS.endFile, reason: MPV_END_FILE_REASONS.eof, error: 0 })
    release()
    expect(await queuing).toEqual({ ok: true })
    expect(events).toEqual([{ type: AUDIO_EVENTS.advanced }])
    expect(closed).toEqual(['7'])
    expect(fake.log).toEqual([MPV_COMMANDS.playlistClear])
  })

  test('when the track ends with nothing queued, the page hears ended and the relay load goes', async () => {
    const { service, fake, events, closed, playing } = setup()
    await service.handle({ ...LOAD, next: null })
    fake.emit({ type: MPV_EVENTS.property, name: MPV_PROPERTIES.pause, data: false })
    fake.emit({ type: MPV_EVENTS.endFile, reason: MPV_END_FILE_REASONS.eof, error: 0 })
    expect(events).toEqual([
      { type: AUDIO_EVENTS.paused, paused: false },
      { type: AUDIO_EVENTS.ended },
    ])
    expect(closed).toEqual(['7'])
    expect(playing).toEqual([true, false])
  })
})

describe('what mpv reports', () => {
  test('time, duration, pause and the cache reach the page, and nothing does while idle', async () => {
    const { service, fake, events } = setup()
    fake.emit({ type: MPV_EVENTS.property, name: MPV_PROPERTIES.timePos, data: 5 })
    expect(events).toEqual([])
    await service.handle(LOAD)
    fake.emit({ type: MPV_EVENTS.property, name: MPV_PROPERTIES.timePos, data: 5 })
    fake.emit({ type: MPV_EVENTS.property, name: MPV_PROPERTIES.timePos, data: null })
    fake.emit({ type: MPV_EVENTS.property, name: MPV_PROPERTIES.duration, data: 200 })
    fake.emit({ type: MPV_EVENTS.property, name: MPV_PROPERTIES.duration, data: null })
    fake.emit({ type: MPV_EVENTS.property, name: MPV_PROPERTIES.pause, data: true })
    fake.emit({ type: MPV_EVENTS.property, name: MPV_PROPERTIES.pausedForCache, data: true })
    fake.emit({ type: MPV_EVENTS.property, name: MPV_PROPERTIES.pausedForCache, data: null })
    expect(events).toEqual([
      { type: AUDIO_EVENTS.time, time: 5 },
      { type: AUDIO_EVENTS.duration, duration: 200 },
      { type: AUDIO_EVENTS.paused, paused: true },
      { type: AUDIO_EVENTS.waiting, waiting: true },
      { type: AUDIO_EVENTS.waiting, waiting: false },
    ])
  })

  test("a track that fails is explained by the server's words, and the relay load retired", async () => {
    const asked: Parameters<FailureExplainer>[0][] = []
    const { service, fake, events, closed } = setup({
      explain: async (input) => {
        asked.push(input)
        return LOCKED
      },
    })
    await service.handle({ ...LOAD, next: null })
    fake.emit({ type: MPV_EVENTS.endFile, reason: MPV_END_FILE_REASONS.error, error: -2 })
    await settle()
    expect(asked.map((input) => input.target.mediaId)).toEqual([7])
    expect(events).toEqual([{ type: AUDIO_EVENTS.error, ...LOCKED }])
    expect(closed).toEqual(['7'])
  })

  test('an explanation that fails still ends the track with the generic words', async () => {
    const { service, fake, events } = setup({
      explain: async () => {
        throw new Error('no answer')
      },
    })
    await service.handle({ ...LOAD, next: null })
    fake.emit({ type: MPV_EVENTS.endFile, reason: MPV_END_FILE_REASONS.error, error: -2 })
    await settle()
    expect(events).toEqual([
      {
        type: AUDIO_EVENTS.error,
        reason: PLAYER_ERROR_REASONS.decode,
        message: PLAYER_MESSAGES.trackStopped,
      },
    ])
  })

  test('a downloaded track plays its file, queued after a server one, and its end retires no load', async () => {
    const { service, fake, closed, events } = setup({ downloaded: [8] })
    await service.handle(LOAD)
    expect(fake.log).toContain(`loadfile ${fileOf(8)} append-play -1 start=0,replaygain=no,af=%0%`)
    fake.emit({ type: MPV_EVENTS.endFile, reason: MPV_END_FILE_REASONS.eof, error: 0 })
    fake.emit({ type: MPV_EVENTS.endFile, reason: MPV_END_FILE_REASONS.eof, error: 0 })
    expect(closed).toEqual(['7'])
    expect(events).toEqual([{ type: AUDIO_EVENTS.advanced }, { type: AUDIO_EVENTS.ended }])
  })

  test('a downloaded track queued again is kept, not resolved twice', async () => {
    const { service, resolved } = setup({ downloaded: [7, 8] })
    await service.handle(LOAD)
    await service.handle(queueOf(8))
    expect(resolved).toEqual([7, 8])
  })

  test('a downloaded track that fails ends with its own words, asking the server nothing', async () => {
    const asked: Parameters<FailureExplainer>[0][] = []
    const { service, fake, events, closed } = setup({
      downloaded: [7],
      explain: async (input) => {
        asked.push(input)
        return LOCKED
      },
    })
    await service.handle({ ...LOAD, next: null })
    fake.emit({ type: MPV_EVENTS.endFile, reason: MPV_END_FILE_REASONS.error, error: -2 })
    await settle()
    expect(asked).toEqual([])
    expect(closed).toEqual([])
    expect(events).toEqual([
      {
        type: AUDIO_EVENTS.error,
        reason: PLAYER_ERROR_REASONS.decode,
        message: PLAYER_MESSAGES.trackStopped,
      },
    ])
  })

  test('the system’s transport controls reach the page as remote commands', async () => {
    const { fake, events } = setup()
    fake.emit({ type: MPV_EVENTS.remote, command: REMOTE_COMMANDS.next })
    fake.emit({ type: MPV_EVENTS.remote, command: REMOTE_COMMANDS.seek, time: 30 })
    expect(events).toEqual([
      { type: AUDIO_EVENTS.remote, command: { kind: REMOTE_COMMANDS.next } },
      { type: AUDIO_EVENTS.remote, command: { kind: REMOTE_COMMANDS.seek, time: 30 } },
    ])
  })

  test('an engine that stops latches dead: the page hears it once and every command fails', async () => {
    const { service, fake, events, closed } = setup()
    await service.handle(LOAD)
    fake.emit({ type: MPV_EVENTS.shutdown })
    fake.emit({ type: MPV_EVENTS.shutdown })
    expect(events).toEqual([
      { type: AUDIO_EVENTS.error, reason: PLAYER_ERROR_REASONS.engine, message: ENGINE_STOPPED },
    ])
    expect(closed).toEqual(['7', '8'])
    expect(service.isDead()).toBe(true)
    expect(await service.handle({ type: AUDIO_COMMANDS.play })).toEqual({
      ok: false,
      reason: PLAYER_REFUSAL_REASONS.engine,
      message: ENGINE_STOPPED,
    })
  })
})

describe('commands', () => {
  test('play, pause, seek within the track and volume go to mpv; a fixed volume is left alone', async () => {
    const { service, fake } = setup()
    await service.handle(LOAD)
    fake.emit({ type: MPV_EVENTS.property, name: MPV_PROPERTIES.duration, data: 100 })
    fake.log.length = 0
    await service.handle({ type: AUDIO_COMMANDS.play })
    await service.handle({ type: AUDIO_COMMANDS.pause })
    await service.handle({ type: AUDIO_COMMANDS.seek, time: 150 })
    await service.handle({ type: AUDIO_COMMANDS.volume, volume: 0.5, muted: true })
    expect(fake.log).toEqual([
      'set pause false',
      'set pause true',
      'seek 100 absolute',
      'set volume 50',
      'set mute true',
    ])
    await service.applyOutput({
      output: { ...PCM, profile: 'passthrough', passthrough: ['ac3'] },
      devices: [],
    })
    fake.log.length = 0
    await service.handle({ type: AUDIO_COMMANDS.volume, volume: 0.2, muted: false })
    expect(fake.log).toEqual([])
  })

  test('a speed goes to mpv within a quarter and four times, and Now Playing runs at it', async () => {
    const { service, fake, shown } = setup()
    await service.handle(LOAD)
    await service.handle({
      type: AUDIO_COMMANDS.nowPlaying,
      info: { title: 'Dune', artist: 'Frank Herbert', album: 'Dune', artwork: null },
    })
    fake.log.length = 0
    expect(await service.handle({ type: AUDIO_COMMANDS.speed, rate: 1.5 })).toEqual({ ok: true })
    expect(shown.at(-1)).toMatchObject({ rate: 1.5, isPlaying: true })
    await service.handle({ type: AUDIO_COMMANDS.speed, rate: 9 })
    await service.handle({ type: AUDIO_COMMANDS.speed, rate: 0.1 })
    expect(fake.log).toEqual(['set speed 1.5', 'set speed 4', 'set speed 0.25'])
    expect(await service.handle({ type: AUDIO_COMMANDS.speed, rate: Number.NaN })).toEqual({
      ok: false,
      reason: PLAYER_REFUSAL_REASONS.refused,
      message: PLAYER_MESSAGES.failed,
    })
  })

  test('a speed mpv refuses leaves Now Playing at the speed it had', async () => {
    const { service, fake, shown } = setup()
    await service.handle(LOAD)
    await service.handle({
      type: AUDIO_COMMANDS.nowPlaying,
      info: { title: 'Dune', artist: 'Frank Herbert', album: 'Dune', artwork: null },
    })
    fake.failing.add('set speed')
    await service.handle({ type: AUDIO_COMMANDS.speed, rate: 2 })
    fake.emit({ type: MPV_EVENTS.property, name: MPV_PROPERTIES.pause, data: false })
    expect(shown.at(-1)).toMatchObject({ rate: 1 })
  })

  test('a seek while nothing plays, and a command with a number that is not one, do nothing', async () => {
    const { service, fake } = setup()
    await settle()
    fake.log.length = 0
    expect(await service.handle({ type: AUDIO_COMMANDS.seek, time: 5 })).toEqual({ ok: true })
    expect(await service.handle({ type: AUDIO_COMMANDS.seek, time: Number.NaN })).toEqual({
      ok: false,
      reason: PLAYER_REFUSAL_REASONS.refused,
      message: PLAYER_MESSAGES.failed,
    })
    expect(fake.log).toEqual([])
  })

  test('a command mpv refuses is refused to the page and warned', async () => {
    const { service, fake, warnings } = setup()
    await service.handle(LOAD)
    fake.failing.add('set pause true')
    expect(await service.handle({ type: AUDIO_COMMANDS.pause })).toEqual({
      ok: false,
      reason: PLAYER_REFUSAL_REASONS.refused,
      message: PLAYER_MESSAGES.failed,
    })
    expect(warnings.some((warning) => warning.includes('mpv pause failed'))).toBe(true)
  })

  test('stop retires both loads, clears Now Playing and stops mpv; reset does the same only while playing', async () => {
    const { service, fake, closed, shown, playing } = setup()
    await service.reset()
    expect(fake.log.filter((entry) => entry === MPV_COMMANDS.stop)).toEqual([])
    await service.handle(LOAD)
    await service.handle({
      type: AUDIO_COMMANDS.nowPlaying,
      info: { title: 'Blue', artist: 'Joni', album: 'Blue', artwork: null },
    })
    await service.reset()
    expect(closed).toEqual(['7', '8'])
    expect(shown.at(-1)).toBeNull()
    expect(fake.log.at(-1)).toBe(MPV_COMMANDS.stop)
    expect(playing.at(-1)).toBe(false)
  })
})

describe('the sound', () => {
  const BASS = EQ_PRESETS.bassBoost

  test('a level is a gain in dB first in the chain, and nothing at all for level 1 and a flat EQ', () => {
    expect(soundFilterOf({ level: 0.5, eq: EQ_PRESETS.flat })).toBe('lavfi=[volume=-6.02dB]')
    expect(soundFilterOf({ level: 1, eq: EQ_PRESETS.flat })).toBe('')
  })

  test('an EQ that is not flat appends its ten bands, an octave wide each', () => {
    const bands = EQ_BANDS.map(
      (frequency, index) => `equalizer=f=${frequency}:t=o:w=1:g=${BASS[index]}`,
    )
    expect(soundFilterOf({ level: 0.5, eq: BASS })).toBe(
      `lavfi=[volume=-6.02dB,${bands.join(',')}]`,
    )
    expect(soundFilterOf({ level: 1, eq: BASS })).toBe(`lavfi=[${bands.join(',')}]`)
  })

  test('each track opens with replaygain off and its own af, the queued one at its level', async () => {
    const { service, fake } = setup()
    await settle()
    await service.handle({ type: AUDIO_COMMANDS.sound, level: 1, nextLevel: null, eq: BASS })
    fake.log.length = 0
    await service.handle({ ...LOAD, level: 0.5, next: { mediaId: 8, level: 0.25, kbps: null } })
    expect(fake.log).toEqual([
      'set pause false',
      loadfileOf({
        mediaId: 7,
        mode: 'replace',
        start: 0,
        filter: soundFilterOf({ level: 0.5, eq: BASS }),
      }),
      MPV_COMMANDS.playlistClear,
      loadfileOf({
        mediaId: 8,
        mode: 'append-play',
        start: 0,
        filter: soundFilterOf({ level: 0.25, eq: BASS }),
      }),
    ])
  })

  test("mpv going on to the queued track keeps its af, so the page's sound for it sets nothing", async () => {
    const { service, fake } = setup()
    await settle()
    await service.handle({ ...LOAD, next: { mediaId: 8, level: 0.5, kbps: null } })
    fake.emit({ type: MPV_EVENTS.endFile, reason: MPV_END_FILE_REASONS.eof, error: 0 })
    fake.log.length = 0
    const sound = {
      type: AUDIO_COMMANDS.sound,
      level: 0.5,
      nextLevel: null,
      eq: EQ_PRESETS.flat,
    } as const
    expect(await service.handle(sound)).toEqual({ ok: true })
    expect(fake.log).toEqual([])
  })

  test('a sound command sets the playing af once, with no ao-reload', async () => {
    const { service, fake } = setup()
    await settle()
    await service.handle({ ...LOAD, next: null })
    fake.emit({ type: MPV_EVENTS.fileLoaded })
    fake.log.length = 0
    const sound = {
      type: AUDIO_COMMANDS.sound,
      level: 0.5,
      nextLevel: null,
      eq: EQ_PRESETS.flat,
    } as const
    expect(await service.handle(sound)).toEqual({ ok: true })
    await service.handle(sound)
    expect(fake.log).toEqual(['set af lavfi=[volume=-6.02dB]'])
    fake.log.length = 0
    await service.handle({ ...sound, level: 1 })
    expect(fake.log).toEqual(['set af '])
    expect(fake.log.some((entry) => entry.startsWith(MPV_COMMANDS.aoReload))).toBe(false)
  })

  test('a sound heard while a file loads is set once it has loaded', async () => {
    const { service, fake } = setup()
    await settle()
    await service.handle({ ...LOAD, next: null })
    fake.log.length = 0
    await service.handle({ type: AUDIO_COMMANDS.sound, level: 1, nextLevel: null, eq: BASS })
    expect(fake.log).toEqual([])
    fake.emit({ type: MPV_EVENTS.fileLoaded })
    await settle()
    expect(fake.log).toEqual([`set af ${soundFilterOf({ level: 1, eq: BASS })}`])
  })

  test('an EQ or a level change queues the next track again with its new af', async () => {
    const { service, fake, resolved } = setup()
    await settle()
    await service.handle(LOAD)
    fake.emit({ type: MPV_EVENTS.fileLoaded })
    fake.log.length = 0
    const sound = { type: AUDIO_COMMANDS.sound, level: 1, nextLevel: 1, eq: BASS } as const
    await service.handle(sound)
    const bass = soundFilterOf({ level: 1, eq: BASS })
    expect(fake.log).toEqual([
      `set af ${bass}`,
      MPV_COMMANDS.playlistClear,
      loadfileOf({ mediaId: 8, mode: 'append-play', start: 0, filter: bass }),
    ])
    fake.log.length = 0
    await service.handle(sound)
    expect(fake.log).toEqual([])
    await service.handle({ ...sound, nextLevel: 0.5 })
    expect(fake.log.at(-1)).toBe(
      loadfileOf({
        mediaId: 8,
        mode: 'append-play',
        start: 0,
        filter: soundFilterOf({ level: 0.5, eq: BASS }),
      }),
    )
    expect(resolved).toEqual([7, 8, 8, 8])
  })

  test('a level that is not a number is refused before mpv hears it', async () => {
    const { service, fake } = setup()
    await settle()
    fake.log.length = 0
    expect(
      await service.handle({
        type: AUDIO_COMMANDS.sound,
        level: Number.NaN,
        nextLevel: null,
        eq: BASS,
      }),
    ).toMatchObject({ ok: false })
    expect(fake.log).toEqual([])
  })
})

describe('now playing', () => {
  test('shows the words with the position, the length and whether it plays, and the cover as bytes', async () => {
    const { service, fake, shown } = setup()
    await service.handle(LOAD)
    fake.emit({ type: MPV_EVENTS.property, name: MPV_PROPERTIES.duration, data: 200 })
    fake.emit({ type: MPV_EVENTS.property, name: MPV_PROPERTIES.timePos, data: 12 })
    expect(shown).toEqual([])
    const artwork = new Uint8Array([1, 2, 3]).buffer
    await service.handle({
      type: AUDIO_COMMANDS.nowPlaying,
      info: { title: 'Blue', artist: 'Joni Mitchell', album: 'Blue', artwork },
    })
    expect(shown).toEqual([
      {
        title: 'Blue',
        artist: 'Joni Mitchell',
        album: 'Blue',
        duration: 200,
        position: 12,
        isPlaying: true,
        rate: 1,
        artwork: Buffer.from([1, 2, 3]),
      },
    ])
    fake.emit({ type: MPV_EVENTS.property, name: MPV_PROPERTIES.pause, data: true })
    expect(shown.at(-1)).toMatchObject({ isPlaying: false, position: 12 })
    await service.handle({ type: AUDIO_COMMANDS.seek, time: 30 })
    expect(shown.at(-1)).toMatchObject({ position: 30 })
    fake.emit({ type: MPV_EVENTS.endFile, reason: MPV_END_FILE_REASONS.error, error: -2 })
    expect(shown.at(-1)).toBeNull()
  })

  test('dispose latches dead and shows nothing more', async () => {
    const { service, fake, shown } = setup()
    await service.handle(LOAD)
    service.dispose()
    expect(service.isDead()).toBe(true)
    fake.emit({ type: MPV_EVENTS.property, name: MPV_PROPERTIES.pause, data: true })
    expect(shown).toEqual([])
    fake.log.length = 0
    await service.applyOutput({ output: PCM, devices: [] })
    expect(fake.log).toEqual([])
  })
})
