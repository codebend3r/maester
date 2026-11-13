import {
  type DesktopPlatform,
  PLAYER_COMMANDS,
  PLAYER_ERROR_REASONS,
  PLAYER_EVENTS,
  PLAYER_SOURCE_KINDS,
  type PlayerCommand,
  type PlayerEvent,
} from '@raven/core'
import {
  MPV_COMMANDS,
  MPV_END_FILE_REASONS,
  MPV_EVENTS,
  MPV_LOADFILE_MODES,
  MPV_PLAYLIST_END,
  MPV_PROPERTIES,
  MPV_SEEK_MODES,
  type MpvEvent,
  type MpvProperty,
} from '@raven/mpv'
import { quietly } from '@/main/log/quietly'
import { createBufferedRanges } from '@/main/player/bufferedRanges'
import { createEndingReports, LOST } from '@/main/player/endingReports'
import { clamp, numbersOf } from '@/main/player/commandNumbers'
import { displayOptions } from '@/main/player/displayOptions'
import { EOF_SHORT_S, ENDINGS, endingOf, type Failure } from '@/main/player/endings'
import { HARDENED_OPTIONS } from '@/main/player/engine'
import { guardedMpv, type MpvControl } from '@/main/player/guardedMpv'
import {
  type AccountRefusalReader,
  type FailureExplainer,
  type LoadTarget,
  loadfileOptionsFor,
  locationOf,
  type ResolveSource,
  sidecarsOfTarget,
  withoutTarget,
} from '@/main/player/loadTarget'
import { ENGINE_GONE, OK, type PlayerOutcome, refuse } from '@/main/player/outcomes'
import { type ApplyOutputProps, isVolumeFixedFor, outputOptions } from '@/main/player/outputOptions'
import { PLAYER_PHASES } from '@/main/player/phases'
import { type CommandOf, createCommandRouter } from '@/main/player/playerCommands'
import { PLAYER_MESSAGES } from '@/main/player/playerMessages'
import { createQuietMpv } from '@/main/player/quietMpv'
import {
  applyOutputOptions,
  createCommandHandler,
  createListeners,
  reporting,
} from '@/main/player/serviceKit'
import { createSidecarAdder } from '@/main/player/sidecars'
import { createStallBudget } from '@/main/player/stallBudget'
import { createTimeReader } from '@/main/player/timeReader'
import { createTrackPicks } from '@/main/player/trackPicks'
import {
  DEAD,
  type FileState,
  freshFile,
  IDLE,
  isLoaded,
  isShowing,
  type PlayerState,
  type Title,
  titleOf,
} from '@/main/player/titleState'
import { sidFor, tracksFromMpv } from '@/main/player/tracksFromMpv'
import type { Timers } from '@/main/timers'
import { messageOf } from '@/shared/messageOf'

export type PlayerActivity = { isPlaying: boolean; isShowing: boolean }

/** How long a server title may wait on its server without the clock moving or bytes arriving. */
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

type ApplyDisplayProps = { refreshRate: number; edrHeadroom: number }

type MpvEndReason = (typeof MPV_END_FILE_REASONS)[keyof typeof MPV_END_FILE_REASONS]

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

/** What the page is told while a title opens and once it has closed: shown, not playing. */
const SHOWING_STILL: PlayerActivity = { isPlaying: false, isShowing: true }

const NOTHING_SHOWN: PlayerActivity = { isPlaying: false, isShowing: false }

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
  let state: PlayerState = IDLE
  /*
   * Bumped by every change of phase (a load, a file-loaded, a stop, an ending, an engine stop),
   * so an async step started for one of them notices it was overtaken and goes no further.
   */
  let epoch = 0
  // Counted up by each load: the newest title's generation.
  let generations = 0
  /*
   * The newest generation whose loadfile mpv accepted, marked in stream order by the wrapper's
   * `onReply`. Events are ordered with replies, so a file-loaded, end-file or redirect that comes
   * before it belongs to the file this load replaces, and one after a refused loadfile belongs to
   * no load at all.
   */
  let answeredGeneration = -1
  // Bumped by every load and stop, so a load still resolving its source notices it was overtaken.
  let loadTicket = 0
  // Loads the stall budget ended while they waited on mpv: they answer a lost connection.
  let stalledTickets: ReadonlySet<number> = new Set()
  let isVolumeFixed = false
  // What the newest load opened, kept past its end so its late warnings are redacted too.
  let lastTarget: LoadTarget | null = null

  // These run inside the wrapper's event drain, so nothing they throw may escape.
  const warn = quietly((message) => reportWarning(withoutTarget({ target: lastTarget, message })))
  const onActivity = reporting({ report: reportActivity, warn, what: 'player activity' })
  const onFirstFrame = reporting({ report: reportFirstFrame, warn, what: 'player first frame' })
  const { emit, subscribe } = createListeners<PlayerEvent>({ warn, what: 'player listener' })

  const mpv = guardedMpv(unguarded)
  const { set: setQuietly, setEach, readOr, harden } = createQuietMpv({ mpv, warn })

  const isDead = () => state.phase === PLAYER_PHASES.dead
  /** What a command overtaken during an await answers: the engine stopping is a failure. */
  const overtaken = () => (isDead() ? ENGINE_GONE : OK)
  const isCurrent = (token: number) => token === epoch

  const fileOf = (): FileState | null => (isLoaded(state) ? state.file : null)

  const updateFile = (change: Partial<FileState>): void => {
    if (!isLoaded(state)) return
    state = { ...state, file: { ...state.file, ...change } }
  }

  const updateTitle = (change: Partial<Title>): void => {
    if (!isShowing(state)) return
    state = { ...state, title: { ...state.title, ...change } }
  }

  const isOwed = (): boolean => {
    if (!isShowing(state) || state.title.target.kind !== PLAYER_SOURCE_KINDS.server) return false
    return state.phase === PLAYER_PHASES.loading || state.file.isWaiting
  }

  /** The account failure the relay saw for a server title, or null. */
  const accountRefusalOf = (target: LoadTarget): Failure | null => {
    if (target.kind !== PLAYER_SOURCE_KINDS.server) return null
    try {
      return refusedAccount(target)
    } catch (error) {
      warn(`player could not read an account refusal: ${messageOf(error)}`)
      return null
    }
  }

  const stopQuietly = () => {
    mpv.command({ args: [MPV_COMMANDS.stop] }).catch((error: unknown) => {
      warn(`mpv stop failed: ${messageOf(error)}`)
    })
  }

  /*
   * The server has kept a title opening, or loaded and waiting with its clock still, for the
   * budget: the load ends as a lost connection, as a file that stops does, unless the relay saw
   * its account refused. The load itself was answered once mpv took its loadfile, so the page
   * hears it here.
   */
  const onServerStalled = () => {
    const title = titleOf(state)
    if (title === null) return
    stalledTickets = new Set([...stalledTickets, title.ticket])
    enter(IDLE)
    warn(`a server title waited ${serverStallMs} ms on its server, so it stops`)
    emit({ type: PLAYER_EVENTS.error, ...(accountRefusalOf(title.target) ?? LOST) })
    onActivity(SHOWING_STILL)
    stopQuietly()
  }

  const stall = createStallBudget({
    timers,
    ms: serverStallMs,
    epoch: () => epoch,
    isOwed,
    onStalled: onServerStalled,
  })

  const clock = createTimeReader({
    timers,
    show: (time) => emit({ type: PLAYER_EVENTS.time, time }),
    read: () => readOr({ name: MPV_PROPERTIES.timePos, fallback: null }),
    epoch: () => epoch,
    isLoaded: () => isLoaded(state),
    onRead: (time) => noteTime(time),
    warn,
  })

  const { finish } = createEndingReports({ emit, warn, explain, epoch: () => epoch })

  const buffered = createBufferedRanges({
    timers,
    show: (ranges) => emit({ type: PLAYER_EVENTS.buffered, ranges }),
  })

  /** Every change of phase: what the last one timed or held is dropped with it. */
  const enter = (next: PlayerState) => {
    state = next
    epoch += 1
    clock.clear()
    stall.clear()
    buffered.clear()
  }

  /** A time mpv gave: a clock that moved starts the stall budget over. */
  const noteTime = (time: number) => {
    if (time !== (fileOf()?.lastTime ?? null)) stall.touch()
    updateFile({ lastTime: time })
    clock.show(time)
  }

  const emitTracks = () => {
    const file = fileOf()
    if (file === null) return
    emit({
      type: PLAYER_EVENTS.tracks,
      tracks: tracksFromMpv({ list: file.trackList, frameRate: file.frameRate }),
    })
  }

  const updateWaiting = () => {
    const file = fileOf()
    if (file === null) return
    const next = file.isPausedForCache || file.isSeeking
    if (next === file.isWaiting) return
    updateFile({ isWaiting: next })
    stall.restart()
    emit({ type: PLAYER_EVENTS.waiting, waiting: next })
  }

  const seekTarget = (value: number) =>
    clamp({ value, min: 0, max: fileOf()?.duration ?? Number.POSITIVE_INFINITY })

  /**
   * The target counts as the time from the moment it is sent, since the eof a seek to the end
   * causes can beat its reply, and a time held from before it is dropped so the scrubber cannot
   * jump back while a slow seek lands. A refused seek puts the time back.
   */
  const sendSeek = async (target: number) => {
    const previous = fileOf()?.lastTime ?? null
    const token = epoch
    updateFile({ lastTime: target })
    clock.seeking()
    try {
      await mpv.command({ args: [MPV_COMMANDS.seek, String(target), MPV_SEEK_MODES.absolute] })
    } catch (error) {
      if (isCurrent(token) && (fileOf()?.lastTime ?? null) === target)
        updateFile({ lastTime: previous })
      throw error
    }
  }

  const sidecarAdder = createSidecarAdder({ mpv, timers, warn, isCurrent })

  const { aidOf, sidOf, audio, subtitle, selectLateSubtitle } = createTrackPicks({
    mpv,
    quiet: { readOr, set: setQuietly },
    trackList: () => fileOf()?.trackList ?? [],
    title: () => titleOf(state),
    isLoading: () => state.phase === PLAYER_PHASES.loading,
    keep: (wanted) => {
      const title = titleOf(state)
      if (title !== null) updateTitle({ wanted: { ...title.wanted, ...wanted } })
    },
    epoch: () => epoch,
    overtaken,
  })

  /** The newly loaded file's tracks, the page's picks applied, and everything the page shows. */
  const snapshot = async (token: number) => {
    const target = titleOf(state)?.target ?? null
    const toAdd = target === null ? [] : sidecarsOfTarget(target)
    // With nothing to add there is nothing to wait for, so no budget timer is armed.
    const sidecars =
      target === null || toAdd.length === 0
        ? { isCurrent: true, pending: null }
        : await sidecarAdder.addWithinBudget({ sidecars: toAdd, kind: target.kind, token })
    if (!sidecars.isCurrent) return
    const [trackList, frameRate, duration] = await Promise.all([
      readOr({ name: MPV_PROPERTIES.trackList, fallback: [] }),
      readOr({ name: MPV_PROPERTIES.containerFps, fallback: null }),
      readOr({ name: MPV_PROPERTIES.duration, fallback: null }),
    ])
    if (!isCurrent(token)) return
    updateFile({ trackList, frameRate, duration })
    await setQuietly({
      name: MPV_PROPERTIES.aid,
      value: aidOf(titleOf(state)?.wanted.audio ?? null),
    })
    if (!isCurrent(token)) return
    await setQuietly({
      name: MPV_PROPERTIES.sid,
      value: sidOf(titleOf(state)?.wanted.subtitle ?? null),
    })
    if (!isCurrent(token)) return
    const missing = titleOf(state)?.wanted.subtitle ?? null
    const isMissing = missing !== null && sidFor({ list: trackList, id: missing }) === null
    if (sidecars.pending !== null && isMissing) {
      selectLateSubtitle({ pending: sidecars.pending, token, id: missing }).catch(
        (error: unknown) => {
          warn(`player could not select a late subtitle: ${messageOf(error)}`)
        },
      )
    }
    const pendingSeek = titleOf(state)?.pendingSeek ?? null
    if (pendingSeek !== null) {
      try {
        await sendSeek(seekTarget(pendingSeek))
      } catch (error) {
        warn(`mpv seek failed: ${messageOf(error)}`)
      }
    }
    const [paused, rate] = await Promise.all([
      readOr({ name: MPV_PROPERTIES.pause, fallback: false }),
      readOr({ name: MPV_PROPERTIES.speed, fallback: 1 }),
    ])
    const file = fileOf()
    if (!isCurrent(token) || file === null) return
    emit({ type: PLAYER_EVENTS.paused, paused })
    emit({ type: PLAYER_EVENTS.duration, duration: file.duration })
    emit({ type: PLAYER_EVENTS.rate, rate })
    // The cache may have run dry while the sidecars were added; the budget goes on then.
    const isWaiting = file.isPausedForCache || file.isSeeking
    updateFile({ isWaiting })
    stall.restart()
    emit({ type: PLAYER_EVENTS.waiting, waiting: isWaiting })
    emitTracks()
    onActivity({ isPlaying: !paused, isShowing: true })
  }

  /*
   * A file-loaded while loaded can only be the newer file arriving after one it replaced already
   * reported, so it takes over with a fresh snapshot.
   */
  const onFileLoaded = () => {
    if (!isShowing(state) || answeredGeneration !== state.title.generation) return
    const { title } = state
    enter({ phase: PLAYER_PHASES.loaded, title, file: freshFile(title) })
    snapshot(epoch).catch((error: unknown) => {
      warn(`player snapshot failed: ${messageOf(error)}`)
    })
  }

  /**
   * mpv reports `redirect` when the file it opened was a playlist, even one named like a video.
   * It would go on to open what the playlist names, which was never granted, or sit idle forever
   * when it names nothing, so this load ends as a file that cannot open. `access-references=no`
   * should stop mpv getting here at all; this is the second line.
   */
  const onRedirect = () => {
    enter(IDLE)
    warn('mpv opened a playlist, which Raven does not follow')
    emit({
      type: PLAYER_EVENTS.error,
      reason: PLAYER_ERROR_REASONS.open,
      message: PLAYER_MESSAGES.cannotOpen,
    })
    onActivity(SHOWING_STILL)
    stopQuietly()
  }

  type OnEndFileProps = { reason: MpvEndReason; error: number }

  const onEndFile = ({ reason, error }: OnEndFileProps) => {
    if (!isShowing(state) || answeredGeneration !== state.title.generation) return
    if (reason === MPV_END_FILE_REASONS.redirect) {
      onRedirect()
      return
    }
    const { target } = state.title
    const file = fileOf()
    const isShort =
      reason === MPV_END_FILE_REASONS.eof &&
      file !== null &&
      file.duration !== null &&
      file.duration - (file.lastTime ?? 0) > EOF_SHORT_S
    const refused = reason === MPV_END_FILE_REASONS.eof ? accountRefusalOf(target) : null
    const during = state.phase
    const ending = endingOf({ phase: during, reason, facts: { refused, isShort } })
    if (ending.kind === ENDINGS.stays) return
    enter(IDLE)
    finish({ ending, during, target, reason, error })
    onActivity(SHOWING_STILL)
  }

  const onEngineStopped = () => {
    if (isDead()) return
    const wasShowing = isShowing(state)
    enter(DEAD)
    emit({
      type: PLAYER_EVENTS.error,
      reason: PLAYER_ERROR_REASONS.engine,
      message: PLAYER_MESSAGES.engineStopped,
    })
    if (wasShowing) onActivity(SHOWING_STILL)
  }

  const onProperty = (event: Extract<MpvEvent, { type: typeof MPV_EVENTS.property }>) => {
    if (!isLoaded(state)) return
    switch (event.name) {
      case MPV_PROPERTIES.timePos:
        if (event.data === null) return
        noteTime(event.data)
        return
      /*
       * mpv clears the duration, the track list and the frame rate as a file closes, and can
       * report that before its end-file, so those emptied values are not the file's.
       */
      case MPV_PROPERTIES.duration:
        if (event.data === null) return
        updateFile({ duration: event.data })
        emit({ type: PLAYER_EVENTS.duration, duration: event.data })
        return
      case MPV_PROPERTIES.speed:
        emit({ type: PLAYER_EVENTS.rate, rate: event.data })
        return
      case MPV_PROPERTIES.pause:
        emit({ type: PLAYER_EVENTS.paused, paused: event.data })
        onActivity({ isPlaying: !event.data, isShowing: true })
        if (event.data) clock.readNow()
        return
      case MPV_PROPERTIES.pausedForCache:
        updateFile({ isPausedForCache: event.data ?? false })
        updateWaiting()
        return
      case MPV_PROPERTIES.seeking:
        updateFile({ isSeeking: event.data ?? false })
        updateWaiting()
        return
      case MPV_PROPERTIES.trackList:
        if (event.data.length === 0) return
        updateFile({ trackList: event.data })
        emitTracks()
        return
      case MPV_PROPERTIES.containerFps:
        if (event.data === null) return
        updateFile({ frameRate: event.data })
        emitTracks()
        return
      case MPV_PROPERTIES.demuxerCacheState:
        buffered.push(event.data?.['seekable-ranges'] ?? [])
        /*
         * A slow link fills the cache for longer than the budget while the clock stands still;
         * bytes still arriving mean the server is there, so only a quiet one runs the budget out.
         */
        if ((event.data?.['raw-input-rate'] ?? 0) > 0) stall.touch()
        return
      default:
        return
    }
  }

  const onPlaybackRestart = () => {
    const file = fileOf()
    if (file === null) return
    if (file.isAwaitingFirstFrame) {
      updateFile({ isAwaitingFirstFrame: false })
      onFirstFrame()
    }
    clock.readNow()
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

  const load = async (command: CommandOf<typeof PLAYER_COMMANDS.load>) => {
    loadTicket += 1
    const ticket = loadTicket
    /*
     * What a load overtaken while it waits answers: its stall budget running out is a refusal
     * the page can show, since nothing will play; an engine stop is a failure, and a newer load
     * or a stop is no failure of this one.
     */
    const bail = () => {
      if (isDead()) return ENGINE_GONE
      if (stalledTickets.has(ticket)) return refuse(PLAYER_MESSAGES.lost)
      return OK
    }
    const resolved = await resolveSource(command.source)
    /*
     * A newer load or a stop while the source resolved: this load touches nothing, as one
     * overtaken while it waits on mpv sends no loadfile.
     */
    if (ticket !== loadTicket || isDead()) return bail()
    if (!resolved.ok) return refuse(resolved.message)
    generations += 1
    const title: Title = {
      ticket,
      generation: generations,
      target: resolved.target,
      loadStart: Math.max(0, command.start),
      wanted: { audio: command.audio, subtitle: command.subtitle },
      pendingSeek: null,
    }
    lastTarget = title.target
    enter({ phase: PLAYER_PHASES.loading, title })
    // A server that sends its headers and then nothing would hold mpv's probe for minutes.
    stall.restart()
    onActivity(SHOWING_STILL)
    /*
     * A stop, reset or newer load overtook this one: sending loadfile now would play a file no
     * page shows. A newer load or a stop is not a failure of this load, so it answers ok; an
     * engine that stopped meanwhile is, so the page can fall back.
     */
    const isMine = () => (titleOf(state)?.generation ?? null) === title.generation
    try {
      const isHardened = await hardening
      if (!isMine()) return bail()
      if (!isHardened) {
        enter(IDLE)
        onActivity(NOTHING_SHOWN)
        return refuse(PLAYER_MESSAGES.failed)
      }
      await mpv.set({ name: MPV_PROPERTIES.pause, value: false })
      if (!isMine()) return bail()
      await mpv.command({
        args: [
          MPV_COMMANDS.loadfile,
          locationOf(title.target),
          MPV_LOADFILE_MODES.replace,
          MPV_PLAYLIST_END,
          loadfileOptionsFor({ target: title.target, start: title.loadStart }),
        ],
        onReply: ({ isOk }) => {
          if (isOk) answeredGeneration = Math.max(answeredGeneration, title.generation)
        },
      })
      return bail()
    } catch (error) {
      if (isMine()) {
        enter(IDLE)
        onActivity(NOTHING_SHOWN)
      }
      throw error
    }
  }

  const seek = async (value: number) => {
    if (state.phase === PLAYER_PHASES.loading) {
      updateTitle({ pendingSeek: Math.max(0, value) })
      return OK
    }
    if (!isLoaded(state)) return OK
    updateTitle({ pendingSeek: null })
    await sendSeek(seekTarget(value))
    return OK
  }

  const stop = async () => {
    loadTicket += 1
    enter(IDLE)
    onActivity(NOTHING_SHOWN)
    await mpv.command({ args: [MPV_COMMANDS.stop] })
    return OK
  }

  const handle = createCommandHandler({
    isDead,
    numbersOf,
    run: createCommandRouter({
      mpv,
      isVolumeFixed: () => isVolumeFixed,
      load,
      seek,
      audio,
      subtitle,
      stop,
    }),
    warn,
  })

  /*
   * Sent before anything else, so mpv applies it before any loadfile. It fails closed: a failed
   * set refuses every load.
   */
  const hardening = harden(HARDENED_OPTIONS)

  OBSERVED.forEach((name) => mpv.observe({ name }))

  return {
    handle,
    receive,
    isDead,
    subscribe,
    reset: async () => {
      if (!isShowing(state)) return
      await handle({ type: PLAYER_COMMANDS.stop })
    },
    // Latches as dead: the mpv behind it is destroyed, so no later load may arm a timer.
    dispose: () => {
      if (isDead()) return
      loadTicket += 1
      enter(DEAD)
    },
    applyOutput: async ({ output, devices }) => {
      if (isDead()) return
      isVolumeFixed = isVolumeFixedFor(output)
      await applyOutputOptions({
        mpv,
        setEach,
        options: outputOptions({ output, devices, canChooseAo, platform }),
        isLoaded: () => isLoaded(state),
        warn,
      })
    },
    applyDisplay: async ({ refreshRate, edrHeadroom }) => {
      if (isDead()) return
      await setEach(displayOptions({ refreshRate, edrHeadroom }))
    },
  }
}
