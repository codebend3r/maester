import {
  AUDIO_COMMANDS,
  AUDIO_EVENTS,
  type AudioBitrate,
  type AudioCommand,
  type AudioEvent,
  type DesktopPlatform,
  EQ_BANDS,
  type EqGains,
  EQ_PRESETS,
  isFlatEq,
  isNumber,
  type NowPlayingInfo,
  PLAYER_ERROR_REASONS,
  PLAYER_SOURCE_KINDS,
  REMOTE_COMMANDS,
  type RemoteCommand,
} from '@raven/core'
import {
  MPV_COMMANDS,
  MPV_END_FILE_REASONS,
  MPV_EVENTS,
  MPV_LOADFILE_MODES,
  MPV_PLAYLIST_END,
  MPV_PROPERTIES,
  MPV_SEEK_MODES,
  type Mpv,
  type MpvEvent,
  type MpvProperty,
} from '@raven/mpv'
import { SPEED_RANGE, clamp } from '@/main/player/commandNumbers'
import { HARDENED_OPTIONS } from '@/main/player/engine'
import { guardedMpv, type MpvControl } from '@/main/player/guardedMpv'
import {
  type FailureExplainer,
  type LoadTarget,
  loadfileOptionsFor,
  locationOf,
  quoted,
  type ResolvedSource,
  type ServerTarget,
  withoutTarget,
} from '@/main/player/loadTarget'
import { ENGINE_GONE, OK, type PlayerOutcome, refuse } from '@/main/player/outcomes'
import {
  type ApplyOutputProps,
  isVolumeFixedFor,
  MPV_OPTIONS,
  outputOptions,
} from '@/main/player/outputOptions'
import { type Phase, PLAYER_PHASES } from '@/main/player/phases'
import { PLAYER_MESSAGES } from '@/main/player/playerMessages'
import type { MusicResolveProps } from '@/main/player/musicSource'
import { createQuietMpv } from '@/main/player/quietMpv'
import { messageOf } from '@/shared/messageOf'

/** The properties the music engine follows. */
export const AUDIO_OBSERVED = [
  MPV_PROPERTIES.timePos,
  MPV_PROPERTIES.duration,
  MPV_PROPERTIES.pause,
  MPV_PROPERTIES.pausedForCache,
] as const satisfies readonly MpvProperty[]

/** The music engine, as its port and host see it. */
export type AudioService = {
  handle: (command: AudioCommand) => Promise<PlayerOutcome>
  receive: (event: MpvEvent) => void
  isDead: () => boolean
  subscribe: (listener: (event: AudioEvent) => void) => () => void
  /** Stops for a page that went away. */
  reset: () => Promise<void>
  dispose: () => void
  applyOutput: (input: ApplyOutputProps) => Promise<void>
}

/** The service's mpv: the control, and the Now Playing calls only an audio surface shows. */
export type AudioMpv = MpvControl & Pick<Mpv, 'nowPlaying' | 'clearNowPlaying'>

type CreateAudioServiceProps = {
  mpv: AudioMpv
  /** A track: its downloaded file, else the one server's, through the music relay. */
  resolve: (props: MusicResolveProps) => Promise<ResolvedSource>
  /** Why a server track failed; a downloaded file's failure needs no server to say. */
  explain: FailureExplainer
  /** Retires a server track's relay load once it is over. */
  closeLoad: (target: ServerTarget) => void
  canChooseAo: boolean
  platform: DesktopPlatform
  onPlaying: (isPlaying: boolean) => void
  warn: (message: string) => void
}

/** How a track ends that the server cannot explain, or that played from a downloaded file. */
const DECODE_FAILURE = {
  reason: PLAYER_ERROR_REASONS.decode,
  message: PLAYER_MESSAGES.trackStopped,
} as const

/** A track mpv holds: the page's id for it, and what it plays from. */
type Held = { mediaId: number; target: LoadTarget }

/**
 * The track mpv holds after the playing one, with what it was queued at: its bitrate, its
 * level and the `af` it starts with.
 */
type Queued = Held & { kbps: AudioBitrate | null; level: number; filter: string }

type QueueNextProps = Omit<Extract<AudioCommand, { type: typeof AUDIO_COMMANDS.queueNext }>, 'type'>

type SetSoundProps = Extract<AudioCommand, { type: typeof AUDIO_COMMANDS.sound }>

type MpvEndFileReason = (typeof MPV_END_FILE_REASONS)[keyof typeof MPV_END_FILE_REASONS]
type LoadfileMode = (typeof MPV_LOADFILE_MODES)[keyof typeof MPV_LOADFILE_MODES]

/** What the system is shown, with the cover already as the addon takes it. */
type Shown = Omit<NowPlayingInfo, 'artwork'> & { artwork: Buffer | null }

/** The numbers a command carries, which must be finite before any of them is used. */
const numbersOf = (command: AudioCommand): number[] => {
  switch (command.type) {
    case AUDIO_COMMANDS.load:
      return [command.start, command.level, ...(command.next === null ? [] : [command.next.level])]
    case AUDIO_COMMANDS.seek:
      return [command.time]
    case AUDIO_COMMANDS.volume:
      return [command.volume]
    case AUDIO_COMMANDS.speed:
      return [command.rate]
    case AUDIO_COMMANDS.sound:
      return [
        command.level,
        ...(command.nextLevel === null ? [] : [command.nextLevel]),
        ...command.eq,
      ]
    case AUDIO_COMMANDS.queueNext:
      return command.next === null ? [] : [command.next.level]
    case AUDIO_COMMANDS.play:
    case AUDIO_COMMANDS.pause:
    case AUDIO_COMMANDS.nowPlaying:
    case AUDIO_COMMANDS.stop:
      return []
    default: {
      const unreachable: never = command
      return unreachable
    }
  }
}

/** mpv's replaygain off: the page's levelling factor stands in its place. */
const REPLAYGAIN_OFF = 'no'

type SoundFilterOfProps = { level: number; eq: EqGains }

/**
 * mpv's `af` for how a track sounds: its levelling factor as a gain in dB first, then the
 * equalizer's ten bands, each an octave wide. A track left as it is (level 1, a flat
 * equalizer) has no filter at all.
 */
export const soundFilterOf = ({ level, eq }: SoundFilterOfProps): string => {
  const volume = level === 1 ? [] : [`volume=${(20 * Math.log10(level)).toFixed(2)}dB`]
  const bands = isFlatEq(eq)
    ? []
    : EQ_BANDS.map((frequency, index) => `equalizer=f=${frequency}:t=o:w=1:g=${eq[index] ?? 0}`)
  const filters = [...volume, ...bands]
  return filters.length === 0 ? '' : `lavfi=[${filters.join(',')}]`
}

const remoteOf = (event: Extract<MpvEvent, { type: typeof MPV_EVENTS.remote }>): RemoteCommand =>
  event.command === REMOTE_COMMANDS.seek
    ? { kind: REMOTE_COMMANDS.seek, time: event.time }
    : { kind: event.command }

/**
 * Music on the desktop: mpv with no video, holding the playing track and the one after
 * it in its playlist, so the two run together with no gap. The queue stays on the page,
 * which hears `advanced` when mpv moves on by itself and then names the next track again.
 * It also tells the system what plays, and hands the system's transport controls to the page.
 */
export const createAudioService = ({
  mpv: unguarded,
  resolve,
  explain,
  closeLoad,
  canChooseAo,
  platform,
  onPlaying: reportPlaying,
  warn: reportWarning,
}: CreateAudioServiceProps): AudioService => {
  let playing: Held | null = null
  let queued: Queued | null = null
  let phase: Phase = PLAYER_PHASES.idle
  // Bumped by every load, stop and engine stop, so a step started for one of them notices it
  // was overtaken.
  let epoch = 0
  let lastTime = 0
  let duration: number | null = null
  let isPaused = false
  // mpv's speed outlives each file, so it is kept across loads and stops too.
  let rate = 1
  let isVolumeFixed = false
  let shown: Shown | null = null
  // The equalizer the page last asked for, which every track mpv opens starts with.
  let eq: EqGains = EQ_PRESETS.flat
  // The `af` the playing track runs, so a `sound` that changes nothing sets nothing.
  let soundFilter = ''
  // The `af` a `sound` asked for while a file loaded, set once it has.
  let pendingFilter: string | null = null
  const listeners = new Set<(listener: AudioEvent) => void>()

  // These run inside the wrapper's event drain, so nothing they throw may escape.
  const warn = (message: string) => {
    try {
      reportWarning(withoutTarget({ target: playing?.target ?? null, message }))
    } catch {
      // A warning that cannot be written has nowhere left to go.
    }
  }
  const onPlaying = (isPlaying: boolean) => {
    try {
      reportPlaying(isPlaying)
    } catch (error) {
      warn(`music activity failed: ${messageOf(error)}`)
    }
  }
  const emit = (event: AudioEvent) => {
    Array.from(listeners).forEach((listener) => {
      try {
        listener(event)
      } catch (error) {
        warn(`music listener failed: ${messageOf(error)}`)
      }
    })
  }

  const mpv = guardedMpv(unguarded)
  const { setEach, harden } = createQuietMpv({ mpv, warn })
  const isDead = () => phase === PLAYER_PHASES.dead

  const showNowPlaying = () => {
    if (shown === null || isDead()) return
    try {
      unguarded.nowPlaying({
        ...shown,
        duration: duration ?? 0,
        position: lastTime,
        isPlaying: !isPaused,
        rate,
      })
    } catch (error) {
      warn(`now playing failed: ${messageOf(error)}`)
    }
  }
  const hideNowPlaying = () => {
    shown = null
    if (isDead()) return
    try {
      unguarded.clearNowPlaying()
    } catch (error) {
      warn(`now playing clear failed: ${messageOf(error)}`)
    }
  }

  const retire = (held: Held | null) => {
    if (held === null || held.target.kind !== PLAYER_SOURCE_KINDS.server) return
    try {
      closeLoad(held.target)
    } catch (error) {
      warn(`music relay close failed: ${messageOf(error)}`)
    }
  }

  /** Back to nothing playing: both relay loads retired, the page told it stopped. */
  const settle = (next: typeof PLAYER_PHASES.idle | typeof PLAYER_PHASES.dead) => {
    phase = next
    epoch += 1
    retire(playing)
    retire(queued)
    playing = null
    queued = null
    pendingFilter = null
    lastTime = 0
    duration = null
    onPlaying(false)
  }

  const onEngineStopped = () => {
    if (isDead()) return
    settle(PLAYER_PHASES.dead)
    hideNowPlaying()
    emit({
      type: AUDIO_EVENTS.error,
      reason: PLAYER_ERROR_REASONS.engine,
      message: PLAYER_MESSAGES.engineStopped,
    })
  }

  const onProperty = (event: Extract<MpvEvent, { type: typeof MPV_EVENTS.property }>) => {
    if (phase === PLAYER_PHASES.idle) return
    switch (event.name) {
      case MPV_PROPERTIES.timePos:
        if (event.data === null) return
        lastTime = event.data
        emit({ type: AUDIO_EVENTS.time, time: event.data })
        return
      // mpv clears the duration as a file closes, before its end-file, so null is not the track's.
      case MPV_PROPERTIES.duration:
        if (event.data === null) return
        duration = event.data
        emit({ type: AUDIO_EVENTS.duration, duration: event.data })
        showNowPlaying()
        return
      case MPV_PROPERTIES.pause:
        isPaused = event.data
        emit({ type: AUDIO_EVENTS.paused, paused: event.data })
        onPlaying(!event.data)
        showNowPlaying()
        return
      case MPV_PROPERTIES.pausedForCache:
        emit({ type: AUDIO_EVENTS.waiting, waiting: event.data ?? false })
        return
      default:
        return
    }
  }

  const onFileLoaded = () => {
    if (phase !== PLAYER_PHASES.loading) return
    phase = PLAYER_PHASES.loaded
    const filter = pendingFilter
    pendingFilter = null
    if (filter === null || filter === soundFilter) return
    soundFilter = filter
    mpv.set({ name: MPV_OPTIONS.af, value: filter }).catch((error: unknown) => {
      warn(`mpv af failed: ${messageOf(error)}`)
    })
  }

  const failureOf = async (target: LoadTarget) => {
    if (target.kind === PLAYER_SOURCE_KINDS.file) return DECODE_FAILURE
    try {
      return await explain({ target, phase: PLAYER_PHASES.loaded })
    } catch (error) {
      warn(`music failure could not be explained: ${messageOf(error)}`)
      return DECODE_FAILURE
    }
  }

  const onEndedEarly = async (target: LoadTarget) => {
    const token = epoch
    const failure = await failureOf(target)
    if (token !== epoch) return
    emit({ type: AUDIO_EVENTS.error, ...failure })
  }

  type OnEndFileProps = { reason: MpvEndFileReason }

  const onEndFile = ({ reason }: OnEndFileProps) => {
    if (phase === PLAYER_PHASES.idle) return
    switch (reason) {
      case MPV_END_FILE_REASONS.eof: {
        if (queued !== null) {
          // mpv has already gone on to the queued track; the page follows.
          // It started with the `af` it was queued with, so the page's `sound` for it is no news.
          retire(playing)
          playing = queued
          soundFilter = queued.filter
          pendingFilter = null
          queued = null
          lastTime = 0
          duration = null
          phase = PLAYER_PHASES.loading
          emit({ type: AUDIO_EVENTS.advanced })
          return
        }
        settle(PLAYER_PHASES.idle)
        emit({ type: AUDIO_EVENTS.ended })
        return
      }
      case MPV_END_FILE_REASONS.error: {
        const ended = playing
        settle(PLAYER_PHASES.idle)
        hideNowPlaying()
        if (ended === null) return
        onEndedEarly(ended.target).catch((error: unknown) => {
          warn(`music ending failed: ${messageOf(error)}`)
        })
        return
      }
      // A stop is Raven's own; a quit or redirect ends through the engine's events.
      case MPV_END_FILE_REASONS.stop:
      case MPV_END_FILE_REASONS.quit:
      case MPV_END_FILE_REASONS.redirect:
        return
      default: {
        const unreachable: never = reason
        return unreachable
      }
    }
  }

  const receive = (event: MpvEvent) => {
    if (isDead()) return
    switch (event.type) {
      case MPV_EVENTS.property:
        onProperty(event)
        return
      case MPV_EVENTS.fileLoaded:
        onFileLoaded()
        return
      case MPV_EVENTS.endFile:
        onEndFile({ reason: event.reason })
        return
      case MPV_EVENTS.remote:
        emit({ type: AUDIO_EVENTS.remote, command: remoteOf(event) })
        return
      case MPV_EVENTS.log:
        warn(`mpv ${event.level} ${event.prefix}: ${event.text}`)
        return
      case MPV_EVENTS.playbackRestart:
        return
      case MPV_EVENTS.error:
        warn(`mpv error: ${event.message}`)
        onEngineStopped()
        return
      case MPV_EVENTS.shutdown:
      case MPV_EVENTS.overflow:
        warn(`mpv ${event.type}`)
        onEngineStopped()
        return
      default: {
        const unreachable: never = event
        return unreachable
      }
    }
  }

  type LoadfileProps = {
    target: LoadTarget
    mode: LoadfileMode
    start: number
    /** The `af` the file starts with. */
    filter: string
  }

  /**
   * Each file carries its sound as per-file options: replaygain off, as the page levels, and its
   * own `af`, so a queued track starts at its own level from its first note at a gapless seam.
   * mpv puts a per-file option back as the file ends, so a `set af` while a file plays lasts
   * until its end, and every file opened here names its own.
   */
  const loadfile = ({ target, mode, start, filter }: LoadfileProps) =>
    mpv.command({
      args: [
        MPV_COMMANDS.loadfile,
        locationOf(target),
        mode,
        MPV_PLAYLIST_END,
        [
          loadfileOptionsFor({ target, start }),
          `${MPV_OPTIONS.replaygain}=${REPLAYGAIN_OFF}`,
          `${MPV_OPTIONS.af}=${quoted(filter)}`,
        ].join(','),
      ],
    })

  /** A load overtaken while it waited: the engine stopping is a failure, a newer load is not. */
  const overtaken = () => (isDead() ? ENGINE_GONE : OK)

  /**
   * What follows the playing track: the queued one is replaced, or cleared for `null`. One
   * already queued at the same bitrate and `af` is kept. `append-play` also starts the track when
   * the playing one ran out meanwhile, and `queued` is set only once mpv holds it, so a refused
   * append leaves the next end a plain `ended`.
   */
  const queueNext = async ({ next }: QueueNextProps): Promise<PlayerOutcome> => {
    if (phase === PLAYER_PHASES.idle) return OK
    const filter = next === null ? '' : soundFilterOf({ level: next.level, eq })
    if (
      next !== null &&
      queued !== null &&
      queued.mediaId === next.mediaId &&
      queued.kbps === next.kbps &&
      queued.filter === filter
    ) {
      return OK
    }
    const token = epoch
    const previous = queued
    await mpv.command({ args: [MPV_COMMANDS.playlistClear] })
    if (token !== epoch) return overtaken()
    // mpv moved on to `previous` while it cleared: the page's `advanced` brings a fresh queueNext.
    if (queued !== previous) return OK
    retire(previous)
    queued = null
    if (next === null) return OK
    const resolved = await resolve({ mediaId: next.mediaId, kbps: next.kbps })
    if (token !== epoch) {
      if (resolved.ok) retire({ mediaId: next.mediaId, target: resolved.target })
      return overtaken()
    }
    // A track that cannot be reached is left out: the playing one ends on its own.
    if (!resolved.ok) return refuse(resolved.message)
    const held: Queued = { ...next, target: resolved.target, filter }
    try {
      await loadfile({
        target: resolved.target,
        mode: MPV_LOADFILE_MODES.appendPlay,
        start: 0,
        filter,
      })
    } catch (error) {
      retire(held)
      throw error
    }
    if (token !== epoch) {
      retire(held)
      return overtaken()
    }
    queued = held
    return OK
  }

  const load = async (
    command: Extract<AudioCommand, { type: typeof AUDIO_COMMANDS.load }>,
  ): Promise<PlayerOutcome> => {
    epoch += 1
    const token = epoch
    const resolved = await resolve({ mediaId: command.mediaId, kbps: command.kbps })
    if (token !== epoch) return overtaken()
    if (!resolved.ok) return refuse(resolved.message)
    const isHardened = await hardening
    if (!isHardened) return refuse(PLAYER_MESSAGES.failed)
    if (token !== epoch) return overtaken()
    retire(playing)
    retire(queued)
    playing = { mediaId: command.mediaId, target: resolved.target }
    queued = null
    phase = PLAYER_PHASES.loading
    lastTime = Math.max(0, command.start)
    duration = null
    soundFilter = soundFilterOf({ level: command.level, eq })
    pendingFilter = null
    await mpv.set({ name: MPV_PROPERTIES.pause, value: false })
    if (token !== epoch) return overtaken()
    await loadfile({
      target: resolved.target,
      mode: MPV_LOADFILE_MODES.replace,
      start: lastTime,
      filter: soundFilter,
    })
    if (token !== epoch) return overtaken()
    return queueNext({ next: command.next })
  }

  /**
   * Levelling and the equalizer: the playing track's `af` is set when it changes, and lasts the
   * rest of that track; the queued one, which would start with the `af` it was queued with, is
   * queued again with the new one.
   */
  const setSound = async (command: SetSoundProps): Promise<PlayerOutcome> => {
    eq = command.eq
    if (phase === PLAYER_PHASES.idle) return OK
    const filter = soundFilterOf({ level: command.level, eq })
    // A file still loading takes it once loaded, or its own `af` would undo it.
    if (phase === PLAYER_PHASES.loading) {
      pendingFilter = filter
    } else if (filter !== soundFilter) {
      await mpv.set({ name: MPV_OPTIONS.af, value: filter })
      soundFilter = filter
    }
    if (queued === null || command.nextLevel === null) return OK
    return queueNext({
      next: { mediaId: queued.mediaId, level: command.nextLevel, kbps: queued.kbps },
    })
  }

  const stop = async (): Promise<PlayerOutcome> => {
    settle(PLAYER_PHASES.idle)
    hideNowPlaying()
    await mpv.command({ args: [MPV_COMMANDS.stop] })
    return OK
  }

  const run = async (command: AudioCommand): Promise<PlayerOutcome> => {
    switch (command.type) {
      case AUDIO_COMMANDS.load:
        return load(command)
      case AUDIO_COMMANDS.queueNext:
        return queueNext(command)
      case AUDIO_COMMANDS.play:
        await mpv.set({ name: MPV_PROPERTIES.pause, value: false })
        return OK
      case AUDIO_COMMANDS.pause:
        await mpv.set({ name: MPV_PROPERTIES.pause, value: true })
        return OK
      case AUDIO_COMMANDS.seek: {
        if (phase === PLAYER_PHASES.idle) return OK
        const target = clamp({
          value: command.time,
          min: 0,
          max: duration ?? Number.POSITIVE_INFINITY,
        })
        lastTime = target
        await mpv.command({ args: [MPV_COMMANDS.seek, String(target), MPV_SEEK_MODES.absolute] })
        showNowPlaying()
        return OK
      }
      case AUDIO_COMMANDS.volume: {
        if (isVolumeFixed) return OK
        const volume = clamp({ value: command.volume, min: 0, max: 1 })
        await mpv.set({ name: MPV_OPTIONS.volume, value: Math.round(volume * 1000) / 10 })
        await mpv.set({ name: MPV_OPTIONS.mute, value: command.muted })
        return OK
      }
      // mpv keeps the pitch at any speed, as its audio-pitch-correction is on by default.
      case AUDIO_COMMANDS.speed: {
        const value = clamp({ value: command.rate, min: SPEED_RANGE.min, max: SPEED_RANGE.max })
        await mpv.set({ name: MPV_PROPERTIES.speed, value })
        rate = value
        showNowPlaying()
        return OK
      }
      case AUDIO_COMMANDS.nowPlaying:
        shown = {
          ...command.info,
          artwork: command.info.artwork === null ? null : Buffer.from(command.info.artwork),
        }
        showNowPlaying()
        return OK
      case AUDIO_COMMANDS.sound:
        return setSound(command)
      case AUDIO_COMMANDS.stop:
        return stop()
      default: {
        const unreachable: never = command
        return unreachable
      }
    }
  }

  const handle = async (command: AudioCommand): Promise<PlayerOutcome> => {
    if (isDead()) return ENGINE_GONE
    if (!numbersOf(command).every(isNumber)) return refuse(PLAYER_MESSAGES.failed)
    try {
      return await run(command)
    } catch (error) {
      warn(`mpv ${command.type} failed: ${messageOf(error)}`)
      // The wrapper rejects what is in flight just before it reports a shutdown.
      return isDead() ? ENGINE_GONE : refuse(PLAYER_MESSAGES.failed)
    }
  }

  // Sent before anything else, so mpv applies it before any loadfile. It fails closed:
  // a failed set refuses every load.
  const hardening = harden(HARDENED_OPTIONS)

  AUDIO_OBSERVED.forEach((name) => mpv.observe({ name }))

  return {
    handle,
    receive,
    isDead,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    reset: async () => {
      if (phase === PLAYER_PHASES.idle || isDead()) return
      await handle({ type: AUDIO_COMMANDS.stop })
    },
    // Latches as dead: the mpv behind it is destroyed.
    dispose: () => {
      if (isDead()) return
      settle(PLAYER_PHASES.dead)
      shown = null
    },
    applyOutput: async ({ output, devices }) => {
      if (isDead()) return
      isVolumeFixed = isVolumeFixedFor(output)
      await setEach(outputOptions({ output, devices, canChooseAo, platform }))
      if (phase !== PLAYER_PHASES.loaded) return
      try {
        await mpv.command({ args: [MPV_COMMANDS.aoReload] })
      } catch (error) {
        warn(`mpv ao-reload failed: ${messageOf(error)}`)
      }
    },
  }
}
