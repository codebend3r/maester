import {
  AUDIO_COMMANDS,
  AUDIO_EVENTS,
  type AudioCommand,
  type AudioEvent,
  type DesktopPlatform,
  isNumber,
  type NowPlayingInfo,
  PLAYER_ERROR_REASONS,
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
  loadfileOptionsFor,
  locationOf,
  type ResolvedServerSource,
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
  /** A track on the one server, through the music relay. */
  resolve: (mediaId: number) => Promise<ResolvedServerSource>
  explain: FailureExplainer
  /** Retires a track's relay load once it is over. */
  closeLoad: (target: ServerTarget) => void
  canChooseAo: boolean
  platform: DesktopPlatform
  onPlaying: (isPlaying: boolean) => void
  warn: (message: string) => void
}

type MpvEndFileReason = (typeof MPV_END_FILE_REASONS)[keyof typeof MPV_END_FILE_REASONS]
type LoadfileMode = (typeof MPV_LOADFILE_MODES)[keyof typeof MPV_LOADFILE_MODES]

/** What the system is shown, with the cover already as the addon takes it. */
type Shown = Omit<NowPlayingInfo, 'artwork'> & { artwork: Buffer | null }

/** The numbers a command carries, which must be finite before any of them is used. */
const numbersOf = (command: AudioCommand): number[] => {
  switch (command.type) {
    case AUDIO_COMMANDS.load:
      return [command.start]
    case AUDIO_COMMANDS.seek:
      return [command.time]
    case AUDIO_COMMANDS.volume:
      return [command.volume]
    case AUDIO_COMMANDS.speed:
      return [command.rate]
    case AUDIO_COMMANDS.queueNext:
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
  let playing: ServerTarget | null = null
  let queued: ServerTarget | null = null
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
  const listeners = new Set<(listener: AudioEvent) => void>()

  // These run inside the wrapper's event drain, so nothing they throw may escape.
  const warn = (message: string) => {
    try {
      reportWarning(withoutTarget({ target: playing, message }))
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

  const retire = (target: ServerTarget | null) => {
    if (target === null) return
    try {
      closeLoad(target)
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
    if (phase === PLAYER_PHASES.loading) phase = PLAYER_PHASES.loaded
  }

  const onEndedEarly = async (target: ServerTarget) => {
    const token = epoch
    let failure
    try {
      failure = await explain({ target, phase: PLAYER_PHASES.loaded })
    } catch (error) {
      warn(`music failure could not be explained: ${messageOf(error)}`)
      failure = { reason: PLAYER_ERROR_REASONS.decode, message: PLAYER_MESSAGES.stopped }
    }
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
          retire(playing)
          playing = queued
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
        onEndedEarly(ended).catch((error: unknown) => {
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
    target: ServerTarget
    mode: LoadfileMode
    start: number
  }

  const loadfile = ({ target, mode, start }: LoadfileProps) =>
    mpv.command({
      args: [
        MPV_COMMANDS.loadfile,
        locationOf(target),
        mode,
        MPV_PLAYLIST_END,
        loadfileOptionsFor({ target, start }),
      ],
    })

  /** A load overtaken while it waited: the engine stopping is a failure, a newer load is not. */
  const overtaken = () => (isDead() ? ENGINE_GONE : OK)

  /**
   * What follows the playing track: the queued one is replaced, or cleared for `null`.
   * `append-play` also starts the track when the playing one ran out meanwhile, and `queued`
   * is set only once mpv holds it, so a refused append leaves the next end a plain `ended`.
   */
  const queueNext = async (next: number | null): Promise<PlayerOutcome> => {
    if (phase === PLAYER_PHASES.idle) return OK
    if (next !== null && (queued?.mediaId ?? null) === next) return OK
    const token = epoch
    retire(queued)
    queued = null
    await mpv.command({ args: [MPV_COMMANDS.playlistClear] })
    if (token !== epoch) return overtaken()
    if (next === null) return OK
    const resolved = await resolve(next)
    if (token !== epoch) {
      if (resolved.ok) retire(resolved.target)
      return overtaken()
    }
    // A track that cannot be reached is left out: the playing one ends on its own.
    if (!resolved.ok) return refuse(resolved.message)
    try {
      await loadfile({ target: resolved.target, mode: MPV_LOADFILE_MODES.appendPlay, start: 0 })
    } catch (error) {
      retire(resolved.target)
      throw error
    }
    if (token !== epoch) {
      retire(resolved.target)
      return overtaken()
    }
    queued = resolved.target
    return OK
  }

  const load = async (
    command: Extract<AudioCommand, { type: typeof AUDIO_COMMANDS.load }>,
  ): Promise<PlayerOutcome> => {
    epoch += 1
    const token = epoch
    const resolved = await resolve(command.mediaId)
    if (token !== epoch) return overtaken()
    if (!resolved.ok) return refuse(resolved.message)
    const isHardened = await hardening
    if (!isHardened) return refuse(PLAYER_MESSAGES.failed)
    if (token !== epoch) return overtaken()
    retire(playing)
    retire(queued)
    playing = resolved.target
    queued = null
    phase = PLAYER_PHASES.loading
    lastTime = Math.max(0, command.start)
    duration = null
    await mpv.set({ name: MPV_PROPERTIES.pause, value: false })
    if (token !== epoch) return overtaken()
    await loadfile({ target: resolved.target, mode: MPV_LOADFILE_MODES.replace, start: lastTime })
    if (token !== epoch) return overtaken()
    return queueNext(command.next)
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
        return queueNext(command.next)
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
