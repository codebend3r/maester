import {
  type DesktopPlatform,
  isNumber,
  isTrackIndex,
  PLAYER_COMMANDS,
  PLAYER_ERROR_REASONS,
  PLAYER_EVENTS,
  PLAYER_SOURCE_KINDS,
  type PlayerCommand,
  type PlayerErrorReason,
  type PlayerEvent,
} from '@raven/core'
import {
  MPV_CHOICES,
  MPV_COMMANDS,
  MPV_END_FILE_REASONS,
  MPV_EVENTS,
  MPV_LOADFILE_MODES,
  MPV_PLAYLIST_END,
  MPV_PROPERTIES,
  MPV_SEEK_MODES,
  type MpvEvent,
  type MpvProperty,
  type MpvTrack,
} from '@raven/mpv'
import { clamp, numbersOf } from '@/main/player/commandNumbers'
import { displayOptions } from '@/main/player/displayOptions'
import { HARDENED_OPTIONS } from '@/main/player/engine'
import { guardedMpv, type MpvControl } from '@/main/player/guardedMpv'
import {
  type AccountRefusalReader,
  type FailureExplainer,
  type LoadTarget,
  loadfileOptionsFor,
  locationOf,
  type ResolveSource,
  type ServerTarget,
  sidecarsOfTarget,
  withoutTarget,
} from '@/main/player/loadTarget'
import { ENGINE_GONE, OK, type PlayerOutcome, refuse } from '@/main/player/outcomes'
import {
  type ApplyOutputProps,
  isVolumeFixedFor,
  MPV_OPTIONS,
  outputOptions,
} from '@/main/player/outputOptions'
import { type Phase, PLAYER_PHASES, type ShowingPhase } from '@/main/player/phases'
import { PLAYER_MESSAGES } from '@/main/player/playerMessages'
import { createQuietMpv } from '@/main/player/quietMpv'
import { createSidecarAdder } from '@/main/player/sidecars'
import { createThrottle } from '@/main/player/throttle'
import { aidFor, sidFor, tracksFromMpv } from '@/main/player/tracksFromMpv'
import type { Timers } from '@/main/stateStore'
import { messageOf } from '@/shared/messageOf'

export type PlayerActivity = { isPlaying: boolean; isShowing: boolean }

/**
 * How long a server title may wait on its server without the clock moving or bytes arriving
 * before the service gives up on it. lavf's own timeouts and reconnects let a server that accepts
 * and then sends nothing hold the page for about two minutes.
 */
export const SERVER_STALL_MS = 30_000

export const OBSERVED = [
  MPV_PROPERTIES.timePos,
  MPV_PROPERTIES.duration,
  MPV_PROPERTIES.pause,
  MPV_PROPERTIES.pausedForCache,
  MPV_PROPERTIES.seeking,
  MPV_PROPERTIES.speed,
  MPV_PROPERTIES.trackList,
  MPV_PROPERTIES.containerFps,
  MPV_PROPERTIES.demuxerCacheState,
] as const satisfies readonly MpvProperty[]

export const BUFFERED_MS = 1000
/** The quiet page hears `time` at most four times a second, whichever path sends it. */
export const TIME_MS = 250
const EOF_SHORT_S = 5

/** How far a buffered range edge must move before the page hears of it. */
const BUFFERED_STEP_S = 0.5

type ApplyDisplayProps = { refreshRate: number; edrHeadroom: number }

export type PlayerService = {
  handle: (command: PlayerCommand) => Promise<PlayerOutcome>
  receive: (event: MpvEvent) => void
  subscribe: (listener: (event: PlayerEvent) => void) => () => void
  /** True once mpv shut down or overflowed: nothing it is asked will play again. */
  isDead: () => boolean
  reset: () => Promise<void>
  /**
   * Forgets the title and every timer without telling mpv or the page, as its mpv is
   * destroyed, so no budget outlives the engine.
   */
  dispose: () => void
  applyOutput: (input: ApplyOutputProps) => Promise<void>
  applyDisplay: (input: ApplyDisplayProps) => Promise<void>
}

type Range = { start: number; end: number }
type Wanted = { audio: number | null; subtitle: string | null }

type HasMovedProps = { shown: readonly Range[] | null; next: readonly Range[] }

const hasMoved = ({ shown, next }: HasMovedProps) =>
  shown === null ||
  shown.length !== next.length ||
  next.some((range, position) => {
    const before = shown[position]
    if (before === undefined) return true
    return (
      Math.abs(range.start - before.start) >= BUFFERED_STEP_S ||
      Math.abs(range.end - before.end) >= BUFFERED_STEP_S
    )
  })

type CreatePlayerServiceProps = {
  mpv: MpvControl
  resolveSource: ResolveSource
  explain: FailureExplainer
  refusedAccount: AccountRefusalReader
  canChooseAo: boolean
  /** Which of mpv's audio outputs `canChooseAo` picks from. */
  platform: DesktopPlatform
  timers: Timers
  /** `SERVER_STALL_MS` unless a test needs it short. */
  serverStallMs?: number
  onActivity: (activity: PlayerActivity) => void
  onFirstFrame: () => void
  warn: (message: string) => void
}

export const createPlayerService = ({
  mpv: unguarded,
  resolveSource,
  explain,
  refusedAccount,
  canChooseAo,
  platform,
  timers,
  serverStallMs = SERVER_STALL_MS,
  onActivity: reportActivity,
  onFirstFrame: reportFirstFrame,
  warn: reportWarning,
}: CreatePlayerServiceProps): PlayerService => {
  // What the newest load opened, and its ticket, which an ending explains and a server's
  // removal stops.
  let opened: LoadTarget | null = null
  // These run inside the wrapper's event drain, so nothing they throw may escape.
  const warn = (message: string) => {
    try {
      reportWarning(withoutTarget({ target: opened, message }))
    } catch {
      // A warning that cannot be written has nowhere left to go.
    }
  }
  const onActivity = (activity: PlayerActivity) => {
    try {
      reportActivity(activity)
    } catch (error) {
      warn(`player activity failed: ${messageOf(error)}`)
    }
  }
  const onFirstFrame = () => {
    try {
      reportFirstFrame()
    } catch (error) {
      warn(`player first frame failed: ${messageOf(error)}`)
    }
  }

  const mpv = guardedMpv(unguarded)

  const listeners = new Set<(event: PlayerEvent) => void>()
  // A function, so the check after an await reads the phase as it is then.
  const isDead = () => phase === PLAYER_PHASES.dead
  /** What a command overtaken during an await answers: the engine stopping is a failure. */
  const overtaken = () => (isDead() ? ENGINE_GONE : OK)
  let phase: Phase = PLAYER_PHASES.idle
  // Bumped by every load, file-loaded, stop, ending and engine stop, so an async step
  // started for one of them notices it was overtaken and goes no further.
  let epoch = 0
  // Bumped by every load, stop, ending and engine stop but never by file-loaded: a
  // replaced file's file-loaded can land while a load waits on mpv, and must not make
  // that load think it was overtaken and skip its loadfile.
  let generation = 0
  // The newest generation whose loadfile mpv accepted, marked in stream order by the
  // wrapper's `onReply`. Events are ordered with replies, so a file-loaded, end-file or
  // redirect that comes before it belongs to the file this load replaces, and one after
  // a refused loadfile belongs to no load at all.
  let answeredGeneration = -1
  // Bumped by every load and stop, so a load still resolving its source notices it was
  // overtaken before it touches anything.
  let loadTicket = 0
  let openedTicket = 0
  // Loads the stall budget ended while they waited on mpv: they answer a lost connection.
  let stalledTickets: ReadonlySet<number> = new Set()
  // Bumped as each subtitle pick starts, before mpv hears it, so a late sidecar's
  // selection can tell a pick still on its way.
  let subtitlePicks = 0
  let wanted: Wanted = { audio: null, subtitle: null }
  let pendingSeek: number | null = null
  let loadStart = 0
  let isAwaitingFirstFrame = false
  let isVolumeFixed = false
  let lastTime: number | null = null
  let duration: number | null = null
  let trackList: readonly MpvTrack[] = []
  let frameRate: number | null = null
  let isPausedForCache = false
  let isSeeking = false
  let isWaiting = false
  let bufferedShown: readonly Range[] | null = null
  let stallTimer: unknown = null
  // The newest time handed to the page, sent or held, and a count of the seeks sent, so
  // a time read that answers late cannot step the clock back unless a seek moved it.
  let shownTime: number | null = null
  let seeks = 0
  let isReadingTime = false
  let isTimeReadWanted = false

  const emit = (event: PlayerEvent) => {
    Array.from(listeners).forEach((listener) => {
      try {
        listener(event)
      } catch (error) {
        warn(`player listener failed: ${messageOf(error)}`)
      }
    })
  }

  const emitTracks = () => {
    emit({ type: PLAYER_EVENTS.tracks, tracks: tracksFromMpv({ list: trackList, frameRate }) })
  }

  const buffered = createThrottle<readonly Range[]>({
    timers,
    ms: BUFFERED_MS,
    show: (ranges) => {
      if (!hasMoved({ shown: bufferedShown, next: ranges })) return false
      bufferedShown = ranges
      emit({
        type: PLAYER_EVENTS.buffered,
        ranges: ranges.map(({ start, end }) => ({ start, end })),
      })
      return true
    },
  })

  const clearBuffered = () => {
    buffered.clear()
    bufferedShown = null
  }

  /** What the newest load opened, when it is a server title. */
  const serverOpened = (): ServerTarget | null =>
    opened !== null && opened.kind === PLAYER_SOURCE_KINDS.server ? opened : null

  const clearStall = () => {
    if (stallTimer !== null) timers.clear(stallTimer)
    stallTimer = null
  }

  const time = createThrottle<number>({
    timers,
    ms: TIME_MS,
    show: (value) => {
      emit({ type: PLAYER_EVENTS.time, time: value })
      return true
    },
  })

  const clearTime = () => {
    time.clear()
    shownTime = null
  }

  const showTime = (value: number) => {
    shownTime = value
    time.push(value)
  }

  const resetFile = () => {
    clearTime()
    lastTime = null
    duration = null
    trackList = []
    frameRate = null
    isPausedForCache = false
    isSeeking = false
    isWaiting = false
    clearStall()
    clearBuffered()
  }

  const settleTo = (next: typeof PLAYER_PHASES.idle | typeof PLAYER_PHASES.dead) => {
    phase = next
    epoch += 1
    generation += 1
    pendingSeek = null
    isAwaitingFirstFrame = false
    clearBuffered()
    clearTime()
    clearStall()
  }

  /** Whether the server owes the title something: still opening, or loaded and waiting. */
  const isOwed = () =>
    serverOpened() !== null &&
    (phase === PLAYER_PHASES.loading || (phase === PLAYER_PHASES.loaded && isWaiting))

  /** The account failure the relay saw for the open server title, or null. */
  const accountRefusal = (): ReturnType<AccountRefusalReader> => {
    const target = serverOpened()
    if (target === null) return null
    try {
      return refusedAccount(target)
    } catch (error) {
      warn(`player could not read an account refusal: ${messageOf(error)}`)
      return null
    }
  }

  /**
   * The server has kept a title opening, or loaded and waiting with its clock still, for
   * `serverStallMs`: the load ends as a lost connection, as a file that stops does, unless the
   * relay saw its account refused. The load itself was answered once mpv took its loadfile, so
   * the page hears it here.
   */
  const onServerStalled = (token: number) => {
    stallTimer = null
    if (token !== epoch || !isOwed()) return
    stalledTickets = new Set([...stalledTickets, openedTicket])
    settleTo(PLAYER_PHASES.idle)
    warn(`a server title waited ${serverStallMs} ms on its server, so it stops`)
    const failure = accountRefusal() ?? {
      reason: PLAYER_ERROR_REASONS.network,
      message: PLAYER_MESSAGES.lost,
    }
    emit({ type: PLAYER_EVENTS.error, ...failure })
    onActivity({ isPlaying: false, isShowing: true })
    mpv.command({ args: [MPV_COMMANDS.stop] }).catch((error: unknown) => {
      warn(`mpv stop failed: ${messageOf(error)}`)
    })
  }

  /** Starts the stall budget over while the server owes the title something; clears it otherwise. */
  const restartStall = () => {
    clearStall()
    if (!isOwed()) return
    const token = epoch
    stallTimer = timers.set({ run: () => onServerStalled(token), ms: serverStallMs })
  }

  const updateWaiting = () => {
    const next = isPausedForCache || isSeeking
    if (next === isWaiting) return
    isWaiting = next
    restartStall()
    emit({ type: PLAYER_EVENTS.waiting, waiting: next })
  }

  const { set: setQuietly, setEach, readOr, harden } = createQuietMpv({ mpv, warn })

  const aidOf = (index: number | null) => {
    if (index === null || !isTrackIndex(index)) return MPV_CHOICES.auto
    return aidFor({ list: trackList, index }) ?? MPV_CHOICES.auto
  }

  const sidOf = (id: string | null) => {
    if (id === null) return 'no'
    return sidFor({ list: trackList, id }) ?? 'no'
  }

  const seekTarget = (value: number) =>
    clamp({ value, min: 0, max: duration ?? Number.POSITIVE_INFINITY })

  /**
   * The target counts as the time from the moment it is sent, since the eof a seek to the
   * end causes can beat its reply, and a time held from before it is dropped so the
   * scrubber cannot jump back while a slow seek lands. A refused seek puts the time back.
   */
  const sendSeek = async (target: number) => {
    const previous = lastTime
    const token = epoch
    lastTime = target
    time.drop()
    shownTime = null
    seeks += 1
    try {
      await mpv.command({ args: [MPV_COMMANDS.seek, String(target), MPV_SEEK_MODES.absolute] })
    } catch (error) {
      if (token === epoch && lastTime === target) lastTime = previous
      throw error
    }
  }

  const sidecarAdder = createSidecarAdder({
    mpv,
    timers,
    warn,
    isCurrent: (token) => token === epoch,
  })

  type SelectLateSubtitleProps = {
    pending: Promise<boolean>
    token: number
    id: string
  }

  /**
   * The subtitle the load asked for may be a sidecar that came after the budget: once the
   * late sidecars are in, it is selected, unless the file changed or the page picked
   * another meanwhile, even one mpv has not answered yet.
   */
  const selectLateSubtitle = async ({ pending, token, id }: SelectLateSubtitleProps) => {
    const picks = subtitlePicks
    const isWanted = () => token === epoch && subtitlePicks === picks && wanted.subtitle === id
    const isCurrent = await pending
    if (!isCurrent || !isWanted()) return
    const list = await readOr({ name: MPV_PROPERTIES.trackList, fallback: [] })
    if (!isWanted()) return
    const sid = sidFor({ list, id })
    if (sid === null) return
    await setQuietly({ name: MPV_PROPERTIES.sid, value: sid })
  }

  const snapshot = async (token: number) => {
    const toAdd = opened === null ? [] : sidecarsOfTarget(opened)
    // With nothing to add there is nothing to wait for, so no budget timer is armed.
    const sidecars =
      opened === null || toAdd.length === 0
        ? { isCurrent: true, pending: null }
        : await sidecarAdder.addWithinBudget({ sidecars: toAdd, kind: opened.kind, token })
    if (!sidecars.isCurrent) return
    const list = await readOr({ name: MPV_PROPERTIES.trackList, fallback: [] })
    const fps = await readOr({ name: MPV_PROPERTIES.containerFps, fallback: null })
    const length = await readOr({ name: MPV_PROPERTIES.duration, fallback: null })
    if (token !== epoch) return
    trackList = list
    frameRate = fps
    duration = length
    await setQuietly({ name: MPV_PROPERTIES.aid, value: aidOf(wanted.audio) })
    if (token !== epoch) return
    await setQuietly({ name: MPV_PROPERTIES.sid, value: sidOf(wanted.subtitle) })
    if (token !== epoch) return
    const missing = wanted.subtitle
    if (sidecars.pending !== null && missing !== null && sidFor({ list, id: missing }) === null) {
      selectLateSubtitle({ pending: sidecars.pending, token, id: missing }).catch(
        (error: unknown) => {
          warn(`player could not select a late subtitle: ${messageOf(error)}`)
        },
      )
    }
    if (pendingSeek !== null) {
      try {
        await sendSeek(seekTarget(pendingSeek))
      } catch (error) {
        warn(`mpv seek failed: ${messageOf(error)}`)
      }
    }
    const paused = await readOr({ name: MPV_PROPERTIES.pause, fallback: false })
    const rate = await readOr({ name: MPV_PROPERTIES.speed, fallback: 1 })
    if (token !== epoch) return
    emit({ type: PLAYER_EVENTS.paused, paused })
    emit({ type: PLAYER_EVENTS.duration, duration })
    emit({ type: PLAYER_EVENTS.rate, rate })
    // The cache may have run dry while the sidecars were added; the budget goes on then.
    isWaiting = isPausedForCache || isSeeking
    restartStall()
    emit({ type: PLAYER_EVENTS.waiting, waiting: isWaiting })
    emitTracks()
    onActivity({ isPlaying: !paused, isShowing: true })
  }

  const onFileLoaded = () => {
    // A file-loaded while loaded can only be the newer file arriving after one it
    // replaced already reported, so it takes over with a fresh snapshot.
    if (phase !== PLAYER_PHASES.loading && phase !== PLAYER_PHASES.loaded) return
    if (answeredGeneration !== generation) return
    phase = PLAYER_PHASES.loaded
    epoch += 1
    resetFile()
    // The addon's time-pos throttle can drop every update before an early eof, so the
    // short-eof check starts from where the file was asked to start.
    lastTime = loadStart
    isAwaitingFirstFrame = true
    snapshot(epoch).catch((error: unknown) => {
      warn(`player snapshot failed: ${messageOf(error)}`)
    })
  }

  /**
   * mpv reports `redirect` when the file it opened was a playlist, even one named like a
   * video. It would go on to open what the playlist names, which was never granted, or
   * sit idle forever when it names nothing, so this load ends as a file that cannot open.
   * `access-references=no` should stop mpv getting here at all; this is the second line.
   */
  const onRedirect = () => {
    if (phase !== PLAYER_PHASES.loading && phase !== PLAYER_PHASES.loaded) return
    settleTo(PLAYER_PHASES.idle)
    warn('mpv opened a playlist, which Raven does not follow')
    emit({
      type: PLAYER_EVENTS.error,
      reason: PLAYER_ERROR_REASONS.open,
      message: PLAYER_MESSAGES.cannotOpen,
    })
    onActivity({ isPlaying: false, isShowing: true })
    mpv.command({ args: [MPV_COMMANDS.stop] }).catch((error: unknown) => {
      warn(`mpv stop failed: ${messageOf(error)}`)
    })
  }

  type EmitFailureProps = {
    failure: { reason: PlayerErrorReason; message: string }
    during: ShowingPhase
  }

  /**
   * An error the page hears: as it is for a file, or as the server explains it for a
   * server title, unless something newer overtook the ending while the server answered.
   */
  const emitFailure = ({ failure, during }: EmitFailureProps) => {
    const asked = serverOpened()
    if (asked === null) {
      emit({ type: PLAYER_EVENTS.error, ...failure })
      return
    }
    const token = epoch
    const explainSafely = async () => {
      try {
        return await explain({ target: asked, phase: during })
      } catch (error) {
        warn(`player could not explain a server failure: ${messageOf(error)}`)
        return { reason: PLAYER_ERROR_REASONS.network, message: PLAYER_MESSAGES.lost } as const
      }
    }
    const report = async () => {
      const explained = await explainSafely()
      if (token !== epoch) return
      emit({ type: PLAYER_EVENTS.error, reason: explained.reason, message: explained.message })
    }
    report().catch((error: unknown) => {
      warn(`player could not report a server failure: ${messageOf(error)}`)
    })
  }

  type OnEndFileProps = { reason: string; error: number }

  const onEndFile = ({ reason, error }: OnEndFileProps) => {
    if (answeredGeneration !== generation) return
    if (reason === MPV_END_FILE_REASONS.redirect) {
      onRedirect()
      return
    }
    // mpv reports `stop` for a file replaced by a load or ended by our own stop, which
    // belongs to a file this service already left.
    if (
      reason !== MPV_END_FILE_REASONS.eof &&
      reason !== MPV_END_FILE_REASONS.error &&
      reason !== MPV_END_FILE_REASONS.quit
    )
      return
    if (phase === PLAYER_PHASES.loading) {
      // mpv ends a stream the server refused as if it ran out; only the relay can tell.
      const refused = reason === MPV_END_FILE_REASONS.eof ? accountRefusal() : null
      if (reason === MPV_END_FILE_REASONS.eof && refused === null) return
      settleTo(PLAYER_PHASES.idle)
      if (refused !== null) {
        warn('mpv ended a server title its account was refused while it opened')
        emitFailure({ failure: refused, during: PLAYER_PHASES.loading })
      } else if (reason === MPV_END_FILE_REASONS.error) {
        warn(`mpv could not open the file (${error})`)
        emitFailure({
          failure: { reason: PLAYER_ERROR_REASONS.open, message: PLAYER_MESSAGES.cannotOpen },
          during: PLAYER_PHASES.loading,
        })
      }
      onActivity({ isPlaying: false, isShowing: true })
      return
    }
    if (phase !== PLAYER_PHASES.loaded) return
    const isShort =
      reason === MPV_END_FILE_REASONS.eof &&
      duration !== null &&
      duration - (lastTime ?? 0) > EOF_SHORT_S
    // A seek near the end that the server refused runs out like the end itself.
    const refused = reason === MPV_END_FILE_REASONS.eof ? accountRefusal() : null
    settleTo(PLAYER_PHASES.idle)
    if (refused !== null) {
      warn('mpv ended a server title its account was refused while it played')
      emitFailure({ failure: refused, during: PLAYER_PHASES.loaded })
    } else if (reason === MPV_END_FILE_REASONS.error || isShort) {
      warn(`mpv stopped playing the file (${reason} ${error})`)
      emitFailure({
        failure: { reason: PLAYER_ERROR_REASONS.decode, message: PLAYER_MESSAGES.stopped },
        during: PLAYER_PHASES.loaded,
      })
    } else if (reason === MPV_END_FILE_REASONS.eof) {
      emit({ type: PLAYER_EVENTS.ended })
    }
    onActivity({ isPlaying: false, isShowing: true })
  }

  const onEngineStopped = () => {
    if (phase === PLAYER_PHASES.dead) return
    const wasShowing = phase === PLAYER_PHASES.loading || phase === PLAYER_PHASES.loaded
    settleTo(PLAYER_PHASES.dead)
    emit({
      type: PLAYER_EVENTS.error,
      reason: PLAYER_ERROR_REASONS.engine,
      message: PLAYER_MESSAGES.engineStopped,
    })
    if (wasShowing) onActivity({ isPlaying: false, isShowing: true })
  }

  /**
   * The addon's throttle sends no trailing time-pos, so a seek or pause reads where it
   * landed. One read is in flight at a time; asks meanwhile become one read after it.
   */
  const showTimeNow = () => {
    if (isReadingTime) {
      isTimeReadWanted = true
      return
    }
    isReadingTime = true
    const token = epoch
    const seeksBefore = seeks
    const show = async () => {
      const read = await readOr({ name: MPV_PROPERTIES.timePos, fallback: null })
      if (token !== epoch || read === null) return
      // A seek sent during the read makes it stale; that seek's playback-restart reads again.
      if (seeks !== seeksBefore) return
      if (shownTime !== null && read < shownTime) return
      if (stallTimer !== null && read !== lastTime) restartStall()
      lastTime = read
      showTime(read)
    }
    show()
      .catch((error: unknown) => {
        warn(`player time read failed: ${messageOf(error)}`)
      })
      .finally(() => {
        isReadingTime = false
        if (!isTimeReadWanted) return
        isTimeReadWanted = false
        if (phase === PLAYER_PHASES.loaded) showTimeNow()
      })
  }

  const onProperty = (event: Extract<MpvEvent, { type: typeof MPV_EVENTS.property }>) => {
    if (phase !== PLAYER_PHASES.loaded) return
    switch (event.name) {
      case MPV_PROPERTIES.timePos:
        if (event.data === null) return
        if (stallTimer !== null && event.data !== lastTime) restartStall()
        lastTime = event.data
        showTime(event.data)
        return
      // mpv clears the duration, the track list and the frame rate as a file closes, and
      // can report that before its end-file, so those emptied values are not the file's.
      case MPV_PROPERTIES.duration:
        if (event.data === null) return
        duration = event.data
        emit({ type: PLAYER_EVENTS.duration, duration: event.data })
        return
      case MPV_PROPERTIES.speed:
        emit({ type: PLAYER_EVENTS.rate, rate: event.data })
        return
      case MPV_PROPERTIES.pause:
        emit({ type: PLAYER_EVENTS.paused, paused: event.data })
        onActivity({ isPlaying: !event.data, isShowing: true })
        if (event.data) showTimeNow()
        return
      case MPV_PROPERTIES.pausedForCache:
        isPausedForCache = event.data ?? false
        updateWaiting()
        return
      case MPV_PROPERTIES.seeking:
        isSeeking = event.data ?? false
        updateWaiting()
        return
      case MPV_PROPERTIES.trackList:
        if (event.data.length === 0) return
        trackList = event.data
        emitTracks()
        return
      case MPV_PROPERTIES.containerFps:
        if (event.data === null) return
        frameRate = event.data
        emitTracks()
        return
      case MPV_PROPERTIES.demuxerCacheState:
        buffered.push(event.data?.['seekable-ranges'] ?? [])
        // A slow link fills the cache for longer than the budget while the clock stands still;
        // bytes still arriving mean the server is there, so only a quiet one runs the budget out.
        if (stallTimer !== null && (event.data?.['raw-input-rate'] ?? 0) > 0) restartStall()
        return
      default:
        return
    }
  }

  const onPlaybackRestart = () => {
    if (phase !== PLAYER_PHASES.loaded) return
    if (isAwaitingFirstFrame) {
      isAwaitingFirstFrame = false
      onFirstFrame()
    }
    showTimeNow()
  }

  const receive = (event: MpvEvent) => {
    if (phase === PLAYER_PHASES.dead) return
    switch (event.type) {
      case MPV_EVENTS.property:
        onProperty(event)
        return
      case MPV_EVENTS.fileLoaded:
        onFileLoaded()
        return
      case MPV_EVENTS.playbackRestart:
        onPlaybackRestart()
        return
      case MPV_EVENTS.endFile:
        onEndFile({ reason: event.reason, error: event.error })
        return
      case MPV_EVENTS.log:
        warn(`mpv ${event.level} ${event.prefix}: ${event.text}`)
        return
      // The system's transport controls belong to the music engine, never to a video.
      case MPV_EVENTS.remote:
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

  const load = async (command: Extract<PlayerCommand, { type: typeof PLAYER_COMMANDS.load }>) => {
    loadTicket += 1
    const ticket = loadTicket
    // What a load overtaken while it waits answers: its stall budget running out is a
    // refusal the page can show, since nothing will play; an engine stop is a failure, and
    // a newer load or a stop is no failure of this one.
    const bail = () => {
      if (isDead()) return ENGINE_GONE
      if (stalledTickets.has(ticket)) return refuse(PLAYER_MESSAGES.lost)
      return OK
    }
    const resolved = await resolveSource(command.source)
    // A newer load or a stop while the source resolved: this load touches nothing, as one
    // overtaken while it waits on mpv sends no loadfile.
    if (ticket !== loadTicket || isDead()) return bail()
    if (!resolved.ok) return refuse(resolved.message)
    opened = resolved.target
    openedTicket = ticket
    phase = PLAYER_PHASES.loading
    epoch += 1
    generation += 1
    const token = generation
    wanted = { audio: command.audio, subtitle: command.subtitle }
    pendingSeek = null
    loadStart = Math.max(0, command.start)
    isAwaitingFirstFrame = true
    resetFile()
    // A server that sends its headers and then nothing would hold mpv's probe for minutes.
    restartStall()
    onActivity({ isPlaying: false, isShowing: true })
    try {
      const isHardened = await hardening
      if (token !== generation) return bail()
      if (!isHardened) {
        settleTo(PLAYER_PHASES.idle)
        onActivity({ isPlaying: false, isShowing: false })
        return refuse(PLAYER_MESSAGES.failed)
      }
      await mpv.set({ name: MPV_PROPERTIES.pause, value: false })
      // A stop, reset or newer load overtook this one: sending loadfile now would play
      // a file no page shows. A newer load or a stop is not a failure of this load, so
      // it answers ok; an engine that stopped meanwhile is, so the page can fall back.
      if (token !== generation) return bail()
      await mpv.command({
        args: [
          MPV_COMMANDS.loadfile,
          locationOf(resolved.target),
          MPV_LOADFILE_MODES.replace,
          MPV_PLAYLIST_END,
          loadfileOptionsFor({ target: resolved.target, start: loadStart }),
        ],
        onReply: ({ isOk }) => {
          if (isOk) answeredGeneration = Math.max(answeredGeneration, token)
        },
      })
      return bail()
    } catch (error) {
      if (token === generation) {
        settleTo(PLAYER_PHASES.idle)
        onActivity({ isPlaying: false, isShowing: false })
      }
      throw error
    }
  }

  const seek = async (value: number) => {
    if (phase === PLAYER_PHASES.loading) {
      pendingSeek = Math.max(0, value)
      return OK
    }
    if (phase !== PLAYER_PHASES.loaded) return OK
    pendingSeek = null
    await sendSeek(seekTarget(value))
    return OK
  }

  const audio = async (index: number | null) => {
    if (index !== null && !isTrackIndex(index)) return refuse(PLAYER_MESSAGES.noTrack)
    if (phase === PLAYER_PHASES.loading) {
      wanted = { ...wanted, audio: index }
      return OK
    }
    if (phase !== PLAYER_PHASES.loaded) return refuse(PLAYER_MESSAGES.noTrack)
    const aid = index === null ? MPV_CHOICES.auto : aidFor({ list: trackList, index })
    if (aid === null) return refuse(PLAYER_MESSAGES.noTrack)
    const token = epoch
    await mpv.set({ name: MPV_PROPERTIES.aid, value: aid })
    if (token !== epoch) return overtaken()
    wanted = { ...wanted, audio: index }
    return OK
  }

  const subtitle = async (id: string | null) => {
    subtitlePicks += 1
    if (phase === PLAYER_PHASES.loading) {
      wanted = { ...wanted, subtitle: id }
      return OK
    }
    if (phase !== PLAYER_PHASES.loaded) return refuse(PLAYER_MESSAGES.noTrack)
    const sid = id === null ? 'no' : sidFor({ list: trackList, id })
    if (sid === null) return refuse(PLAYER_MESSAGES.noTrack)
    const token = epoch
    await mpv.set({ name: MPV_PROPERTIES.sid, value: sid })
    if (token !== epoch) return overtaken()
    wanted = { ...wanted, subtitle: id }
    return OK
  }

  const stop = async () => {
    loadTicket += 1
    settleTo(PLAYER_PHASES.idle)
    onActivity({ isPlaying: false, isShowing: false })
    await mpv.command({ args: [MPV_COMMANDS.stop] })
    return OK
  }

  const run = async (command: PlayerCommand): Promise<PlayerOutcome> => {
    switch (command.type) {
      case PLAYER_COMMANDS.load:
        return load(command)
      case PLAYER_COMMANDS.play:
        await mpv.set({ name: MPV_PROPERTIES.pause, value: false })
        return OK
      case PLAYER_COMMANDS.pause:
        await mpv.set({ name: MPV_PROPERTIES.pause, value: true })
        return OK
      case PLAYER_COMMANDS.seek:
        return seek(command.time)
      case PLAYER_COMMANDS.audio:
        return audio(command.index)
      case PLAYER_COMMANDS.subtitle:
        return subtitle(command.id)
      case PLAYER_COMMANDS.volume: {
        if (isVolumeFixed) return OK
        const volume = clamp({ value: command.volume, min: 0, max: 1 })
        await mpv.set({ name: MPV_OPTIONS.volume, value: Math.round(volume * 1000) / 10 })
        await mpv.set({ name: MPV_OPTIONS.mute, value: command.muted })
        return OK
      }
      case PLAYER_COMMANDS.speed:
        await mpv.set({
          name: MPV_PROPERTIES.speed,
          value: clamp({ value: command.rate, min: 0.25, max: 4 }),
        })
        return OK
      case PLAYER_COMMANDS.subtitleScale:
        await mpv.set({
          name: MPV_OPTIONS.subScale,
          value: clamp({ value: command.scale, min: 0.5, max: 3 }),
        })
        return OK
      case PLAYER_COMMANDS.stats:
        await mpv.command({ args: [MPV_COMMANDS.scriptBinding, 'stats/display-stats-toggle'] })
        return OK
      case PLAYER_COMMANDS.stop:
        return stop()
      default: {
        const unreachable: never = command
        return unreachable
      }
    }
  }

  const handle = async (command: PlayerCommand): Promise<PlayerOutcome> => {
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

  const reset = async () => {
    if (phase === PLAYER_PHASES.idle || phase === PLAYER_PHASES.dead) return
    await handle({ type: PLAYER_COMMANDS.stop })
  }

  // Sent before anything else, so mpv applies it before any loadfile. It fails closed:
  // a failed set refuses every load.
  const hardening = harden(HARDENED_OPTIONS)

  OBSERVED.forEach((name) => mpv.observe({ name }))

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
    reset,
    // Latches as dead: the mpv behind it is destroyed, so no later load may arm a timer.
    dispose: () => {
      if (phase === PLAYER_PHASES.dead) return
      loadTicket += 1
      settleTo(PLAYER_PHASES.dead)
    },
    applyOutput: async ({ output, devices }) => {
      if (phase === PLAYER_PHASES.dead) return
      isVolumeFixed = isVolumeFixedFor(output)
      await setEach(outputOptions({ output, devices, canChooseAo, platform }))
      if (phase !== PLAYER_PHASES.loaded) return
      try {
        await mpv.command({ args: [MPV_COMMANDS.aoReload] })
      } catch (error) {
        warn(`mpv ao-reload failed: ${messageOf(error)}`)
      }
    },
    applyDisplay: async ({ refreshRate, edrHeadroom }) => {
      if (phase === PLAYER_PHASES.dead) return
      await setEach(displayOptions({ refreshRate, edrHeadroom }))
    },
  }
}
