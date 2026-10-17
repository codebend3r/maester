import {
  isNumber,
  type OutputSettings,
  type PlayerCommand,
  type PlayerEvent,
  type PlayerRefusalReason,
  type PlayerSource,
} from '@raven/core'
import type { Mpv, MpvEvent, MpvProperty, MpvPropertyValue, MpvTrack } from '@raven/mpv'
import type { Grants } from '@/main/grants'
import { displayOptions } from '@/main/player/displayOptions'
import { HARDENED_OPTIONS } from '@/main/player/engine'
import { isVolumeFixedFor, type MpvOption, outputOptions } from '@/main/player/outputOptions'
import { aidFor, sidFor, tracksFromMpv } from '@/main/player/tracksFromMpv'
import type { Timers } from '@/main/stateStore'
import { type AudioDevice, ENGINE_STOPPED, isTrackIndex } from '@/shared/protocol'
import { messageOf } from '@/shared/messageOf'

export type MpvControl = Pick<Mpv, 'command' | 'set' | 'read' | 'observe'>
export type PlayerOutcome =
  | { ok: true }
  | { ok: false; reason: PlayerRefusalReason; message: string }
export type PlayerActivity = { isPlaying: boolean; isShowing: boolean }

export const PLAYER_MESSAGES = {
  serverTitles: 'raven player cannot play server titles yet.',
  notOpen: 'That video is no longer open. Open it again from Home.',
  cannotOpen: 'raven player could not open this video.',
  stopped: 'raven player could not keep playing this video.',
  engineStopped: ENGINE_STOPPED,
  noTrack: 'That track is not in this video.',
  failed: 'raven player could not do that.',
} as const

export const OBSERVED = [
  'time-pos',
  'duration',
  'pause',
  'paused-for-cache',
  'seeking',
  'speed',
  'track-list',
  'container-fps',
  'demuxer-cache-state',
] as const satisfies readonly MpvProperty[]

export const BUFFERED_MS = 1000
/** The quiet page hears `time` at most four times a second, whichever path sends it. */
export const TIME_MS = 250
export const EOF_SHORT_S = 5

/** How far a buffered range edge must move before the page hears of it. */
const BUFFERED_STEP_S = 0.5

export const resolveSourceWith =
  ({ grants }: { grants: Pick<Grants, 'fileOf'> }) =>
  (source: PlayerSource): { ok: true; path: string } | { ok: false; message: string } => {
    switch (source.kind) {
      case 'server':
        return { ok: false, message: PLAYER_MESSAGES.serverTitles }
      case 'file': {
        const file = grants.fileOf(source.fileId)
        if (file === null) return { ok: false, message: PLAYER_MESSAGES.notOpen }
        return { ok: true, path: file.path }
      }
      default: {
        const unreachable: never = source
        return unreachable
      }
    }
  }

export type PlayerService = {
  handle: (command: PlayerCommand) => Promise<PlayerOutcome>
  receive: (event: MpvEvent) => void
  subscribe: (listener: (event: PlayerEvent) => void) => () => void
  /** True once mpv shut down or overflowed: nothing it is asked will play again. */
  isDead: () => boolean
  reset: () => Promise<void>
  applyOutput: (input: { output: OutputSettings; devices: readonly AudioDevice[] }) => Promise<void>
  applyDisplay: (input: { refreshRate: number; edrHeadroom: number }) => Promise<void>
}

const PHASES = ['idle', 'loading', 'loaded', 'dead'] as const
type Phase = (typeof PHASES)[number]

type Range = { start: number; end: number }
type Wanted = { audio: number | null; subtitle: string | null }

const OK: PlayerOutcome = { ok: true }
const refuse = (message: string): PlayerOutcome => ({ ok: false, reason: 'refused', message })
const ENGINE_GONE: PlayerOutcome = {
  ok: false,
  reason: 'engine',
  message: PLAYER_MESSAGES.engineStopped,
}

const clamp = ({ value, min, max }: { value: number; min: number; max: number }) =>
  Math.min(max, Math.max(min, value))

const hasMoved = ({ shown, next }: { shown: readonly Range[] | null; next: readonly Range[] }) =>
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

/** The numbers a command carries, which must be finite before any of them is used. */
const numbersOf = (command: PlayerCommand): number[] => {
  switch (command.type) {
    case 'load':
      return [command.start, ...(command.audio === null ? [] : [command.audio])]
    case 'seek':
      return [command.time]
    case 'audio':
      return command.index === null ? [] : [command.index]
    case 'volume':
      return [command.volume]
    case 'speed':
      return [command.rate]
    case 'subtitleScale':
      return [command.scale]
    case 'play':
    case 'pause':
    case 'subtitle':
    case 'stats':
    case 'stop':
      return []
    default: {
      const unreachable: never = command
      return unreachable
    }
  }
}

export const createPlayerService = ({
  mpv,
  resolveSource,
  canChooseAo,
  timers,
  onActivity: reportActivity,
  onFirstFrame: reportFirstFrame,
  warn: reportWarning,
}: {
  mpv: MpvControl
  resolveSource: ReturnType<typeof resolveSourceWith>
  canChooseAo: boolean
  timers: Timers
  onActivity: (activity: PlayerActivity) => void
  onFirstFrame: () => void
  warn: (message: string) => void
}): PlayerService => {
  // These run inside the wrapper's event drain, so nothing they throw may escape.
  const warn = (message: string) => {
    try {
      reportWarning(message)
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

  const listeners = new Set<(event: PlayerEvent) => void>()
  // A function, so the check after an await reads the phase as it is then.
  const isDead = () => phase === 'dead'
  /** What a command overtaken during an await answers: the engine stopping is a failure. */
  const overtaken = () => (isDead() ? ENGINE_GONE : OK)
  let phase: Phase = 'idle'
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
  let bufferedLatest: readonly Range[] | null = null
  let bufferedTimer: unknown = null
  let timeTimer: unknown = null
  let timeHeld: number | null = null
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
    emit({ type: 'tracks', tracks: tracksFromMpv({ list: trackList, frameRate }) })
  }

  const clearBuffered = () => {
    if (bufferedTimer !== null) timers.clear(bufferedTimer)
    bufferedTimer = null
    bufferedShown = null
    bufferedLatest = null
  }

  const clearTime = () => {
    if (timeTimer !== null) timers.clear(timeTimer)
    timeTimer = null
    timeHeld = null
    shownTime = null
  }

  const showTime = (time: number) => {
    shownTime = time
    if (timeTimer !== null) {
      timeHeld = time
      return
    }
    emit({ type: 'time', time })
    timeTimer = timers.set(() => {
      timeTimer = null
      const held = timeHeld
      timeHeld = null
      if (held !== null) showTime(held)
    }, TIME_MS)
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
    clearBuffered()
  }

  const settleTo = (next: 'idle' | 'dead') => {
    phase = next
    epoch += 1
    generation += 1
    pendingSeek = null
    isAwaitingFirstFrame = false
    clearBuffered()
    clearTime()
  }

  const showBuffered = (ranges: readonly Range[]) => {
    if (!hasMoved({ shown: bufferedShown, next: ranges })) return
    bufferedShown = ranges
    emit({ type: 'buffered', ranges: ranges.map(({ start, end }) => ({ start, end })) })
    bufferedTimer = timers.set(() => {
      bufferedTimer = null
      const latest = bufferedLatest
      bufferedLatest = null
      if (latest !== null) showBuffered(latest)
    }, BUFFERED_MS)
  }

  const onBuffered = (ranges: readonly Range[]) => {
    if (bufferedTimer !== null) {
      bufferedLatest = ranges
      return
    }
    showBuffered(ranges)
  }

  const updateWaiting = () => {
    const next = isPausedForCache || isSeeking
    if (next === isWaiting) return
    isWaiting = next
    emit({ type: 'waiting', waiting: next })
  }

  const setQuietly = async ({ name, value }: MpvOption) => {
    try {
      await mpv.set({ name, value })
    } catch (error) {
      warn(`mpv set ${name} failed: ${messageOf(error)}`)
    }
  }

  const setEach = (options: readonly MpvOption[]) =>
    options.reduce<Promise<void>>(
      (chain, option) => chain.then(() => setQuietly(option)),
      Promise.resolve(),
    )

  const readOr = async <K extends MpvProperty>({
    name,
    fallback,
  }: {
    name: K
    fallback: MpvPropertyValue<K>
  }): Promise<MpvPropertyValue<K>> => {
    try {
      return await mpv.read({ name })
    } catch (error) {
      warn(`mpv read ${name} failed: ${messageOf(error)}`)
      return fallback
    }
  }

  const aidOf = (index: number | null) => {
    if (index === null || !isTrackIndex(index)) return 'auto'
    return aidFor({ list: trackList, index }) ?? 'auto'
  }

  const sidOf = (id: string | null) => {
    if (id === null) return 'no'
    return sidFor({ list: trackList, id }) ?? 'no'
  }

  const seekTarget = (time: number) =>
    clamp({ value: time, min: 0, max: duration ?? Number.POSITIVE_INFINITY })

  /**
   * The target counts as the time from the moment it is sent, since the eof a seek to the
   * end causes can beat its reply, and a time held from before it is dropped so the
   * scrubber cannot jump back while a slow seek lands. A refused seek puts the time back.
   */
  const sendSeek = async (target: number) => {
    const previous = lastTime
    const token = epoch
    lastTime = target
    timeHeld = null
    shownTime = null
    seeks += 1
    try {
      await mpv.command({ args: ['seek', String(target), 'absolute'] })
    } catch (error) {
      if (token === epoch && lastTime === target) lastTime = previous
      throw error
    }
  }

  const snapshot = async (token: number) => {
    const list = await readOr({ name: 'track-list', fallback: [] })
    const fps = await readOr({ name: 'container-fps', fallback: null })
    const length = await readOr({ name: 'duration', fallback: null })
    if (token !== epoch) return
    trackList = list
    frameRate = fps
    duration = length
    await setQuietly({ name: 'aid', value: aidOf(wanted.audio) })
    if (token !== epoch) return
    await setQuietly({ name: 'sid', value: sidOf(wanted.subtitle) })
    if (token !== epoch) return
    if (pendingSeek !== null) {
      try {
        await sendSeek(seekTarget(pendingSeek))
      } catch (error) {
        warn(`mpv seek failed: ${messageOf(error)}`)
      }
    }
    const paused = await readOr({ name: 'pause', fallback: false })
    const rate = await readOr({ name: 'speed', fallback: 1 })
    if (token !== epoch) return
    emit({ type: 'paused', paused })
    emit({ type: 'duration', duration })
    emit({ type: 'rate', rate })
    isWaiting = false
    emit({ type: 'waiting', waiting: false })
    emitTracks()
    onActivity({ isPlaying: !paused, isShowing: true })
  }

  const onFileLoaded = () => {
    // A file-loaded while loaded can only be the newer file arriving after one it
    // replaced already reported, so it takes over with a fresh snapshot.
    if (phase !== 'loading' && phase !== 'loaded') return
    if (answeredGeneration !== generation) return
    phase = 'loaded'
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
    if (phase !== 'loading' && phase !== 'loaded') return
    settleTo('idle')
    warn('mpv opened a playlist, which raven player does not follow')
    emit({ type: 'error', reason: 'open', message: PLAYER_MESSAGES.cannotOpen })
    onActivity({ isPlaying: false, isShowing: true })
    mpv.command({ args: ['stop'] }).catch((error: unknown) => {
      warn(`mpv stop failed: ${messageOf(error)}`)
    })
  }

  const onEndFile = ({ reason, error }: { reason: string; error: number }) => {
    if (answeredGeneration !== generation) return
    if (reason === 'redirect') {
      onRedirect()
      return
    }
    // mpv reports `stop` for a file replaced by a load or ended by our own stop, which
    // belongs to a file this service already left.
    if (reason !== 'eof' && reason !== 'error' && reason !== 'quit') return
    if (phase === 'loading') {
      if (reason === 'eof') return
      settleTo('idle')
      if (reason === 'error') {
        warn(`mpv could not open the file (${error})`)
        emit({ type: 'error', reason: 'open', message: PLAYER_MESSAGES.cannotOpen })
      }
      onActivity({ isPlaying: false, isShowing: true })
      return
    }
    if (phase !== 'loaded') return
    const isShort =
      reason === 'eof' && duration !== null && duration - (lastTime ?? 0) > EOF_SHORT_S
    settleTo('idle')
    if (reason === 'error' || isShort) {
      warn(`mpv stopped playing the file (${reason} ${error})`)
      emit({ type: 'error', reason: 'decode', message: PLAYER_MESSAGES.stopped })
    } else if (reason === 'eof') {
      emit({ type: 'ended' })
    }
    onActivity({ isPlaying: false, isShowing: true })
  }

  const onEngineStopped = () => {
    if (phase === 'dead') return
    const wasShowing = phase === 'loading' || phase === 'loaded'
    settleTo('dead')
    emit({ type: 'error', reason: 'engine', message: PLAYER_MESSAGES.engineStopped })
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
      const time = await readOr({ name: 'time-pos', fallback: null })
      if (token !== epoch || time === null) return
      // A seek sent during the read makes it stale; that seek's playback-restart reads again.
      if (seeks !== seeksBefore) return
      if (shownTime !== null && time < shownTime) return
      lastTime = time
      showTime(time)
    }
    show()
      .catch((error: unknown) => {
        warn(`player time read failed: ${messageOf(error)}`)
      })
      .finally(() => {
        isReadingTime = false
        if (!isTimeReadWanted) return
        isTimeReadWanted = false
        if (phase === 'loaded') showTimeNow()
      })
  }

  const onProperty = (event: Extract<MpvEvent, { type: 'property' }>) => {
    if (phase !== 'loaded') return
    switch (event.name) {
      case 'time-pos':
        if (event.data === null) return
        lastTime = event.data
        showTime(event.data)
        return
      // mpv clears the duration, the track list and the frame rate as a file closes, and
      // can report that before its end-file, so those emptied values are not the file's.
      case 'duration':
        if (event.data === null) return
        duration = event.data
        emit({ type: 'duration', duration: event.data })
        return
      case 'speed':
        emit({ type: 'rate', rate: event.data })
        return
      case 'pause':
        emit({ type: 'paused', paused: event.data })
        onActivity({ isPlaying: !event.data, isShowing: true })
        if (event.data) showTimeNow()
        return
      case 'paused-for-cache':
        isPausedForCache = event.data ?? false
        updateWaiting()
        return
      case 'seeking':
        isSeeking = event.data ?? false
        updateWaiting()
        return
      case 'track-list':
        if (event.data.length === 0) return
        trackList = event.data
        emitTracks()
        return
      case 'container-fps':
        if (event.data === null) return
        frameRate = event.data
        emitTracks()
        return
      case 'demuxer-cache-state':
        onBuffered(event.data?.['seekable-ranges'] ?? [])
        return
      default:
        return
    }
  }

  const onPlaybackRestart = () => {
    if (phase !== 'loaded') return
    if (isAwaitingFirstFrame) {
      isAwaitingFirstFrame = false
      onFirstFrame()
    }
    showTimeNow()
  }

  const receive = (event: MpvEvent) => {
    if (phase === 'dead') return
    switch (event.type) {
      case 'property':
        onProperty(event)
        return
      case 'file-loaded':
        onFileLoaded()
        return
      case 'playback-restart':
        onPlaybackRestart()
        return
      case 'end-file':
        onEndFile({ reason: event.reason, error: event.error })
        return
      case 'log':
        warn(`mpv ${event.level} ${event.prefix}: ${event.text}`)
        return
      case 'error':
        warn(`mpv error: ${event.message}`)
        onEngineStopped()
        return
      case 'shutdown':
      case 'overflow':
        warn(`mpv ${event.type}`)
        onEngineStopped()
        return
      default: {
        const unreachable: never = event
        return unreachable
      }
    }
  }

  const load = async (command: Extract<PlayerCommand, { type: 'load' }>) => {
    const resolved = resolveSource(command.source)
    if (!resolved.ok) return refuse(resolved.message)
    phase = 'loading'
    epoch += 1
    generation += 1
    const token = generation
    wanted = { audio: command.audio, subtitle: command.subtitle }
    pendingSeek = null
    loadStart = Math.max(0, command.start)
    isAwaitingFirstFrame = true
    resetFile()
    onActivity({ isPlaying: false, isShowing: true })
    try {
      const isHardened = await hardening
      if (token !== generation) return overtaken()
      if (!isHardened) {
        settleTo('idle')
        onActivity({ isPlaying: false, isShowing: false })
        return refuse(PLAYER_MESSAGES.failed)
      }
      await mpv.set({ name: 'pause', value: false })
      // A stop, reset or newer load overtook this one: sending loadfile now would play
      // a file no page shows. A newer load or a stop is not a failure of this load, so
      // it answers ok; an engine that stopped meanwhile is, so the page can fall back.
      if (token !== generation) return overtaken()
      await mpv.command({
        args: ['loadfile', resolved.path, 'replace', '-1', `start=${loadStart}`],
        onReply: ({ isOk }) => {
          if (isOk) answeredGeneration = Math.max(answeredGeneration, token)
        },
      })
      return overtaken()
    } catch (error) {
      if (token === generation) {
        settleTo('idle')
        onActivity({ isPlaying: false, isShowing: false })
      }
      throw error
    }
  }

  const seek = async (time: number) => {
    if (phase === 'loading') {
      pendingSeek = Math.max(0, time)
      return OK
    }
    if (phase !== 'loaded') return OK
    pendingSeek = null
    await sendSeek(seekTarget(time))
    return OK
  }

  const audio = async (index: number | null) => {
    if (index !== null && !isTrackIndex(index)) return refuse(PLAYER_MESSAGES.noTrack)
    if (phase === 'loading') {
      wanted = { ...wanted, audio: index }
      return OK
    }
    if (phase !== 'loaded') return refuse(PLAYER_MESSAGES.noTrack)
    const aid = index === null ? 'auto' : aidFor({ list: trackList, index })
    if (aid === null) return refuse(PLAYER_MESSAGES.noTrack)
    const token = epoch
    await mpv.set({ name: 'aid', value: aid })
    if (token !== epoch) return overtaken()
    wanted = { ...wanted, audio: index }
    return OK
  }

  const subtitle = async (id: string | null) => {
    if (phase === 'loading') {
      wanted = { ...wanted, subtitle: id }
      return OK
    }
    if (phase !== 'loaded') return refuse(PLAYER_MESSAGES.noTrack)
    const sid = id === null ? 'no' : sidFor({ list: trackList, id })
    if (sid === null) return refuse(PLAYER_MESSAGES.noTrack)
    const token = epoch
    await mpv.set({ name: 'sid', value: sid })
    if (token !== epoch) return overtaken()
    wanted = { ...wanted, subtitle: id }
    return OK
  }

  const stop = async () => {
    settleTo('idle')
    onActivity({ isPlaying: false, isShowing: false })
    await mpv.command({ args: ['stop'] })
    return OK
  }

  const run = async (command: PlayerCommand): Promise<PlayerOutcome> => {
    switch (command.type) {
      case 'load':
        return load(command)
      case 'play':
        await mpv.set({ name: 'pause', value: false })
        return OK
      case 'pause':
        await mpv.set({ name: 'pause', value: true })
        return OK
      case 'seek':
        return seek(command.time)
      case 'audio':
        return audio(command.index)
      case 'subtitle':
        return subtitle(command.id)
      case 'volume': {
        if (isVolumeFixed) return OK
        const volume = clamp({ value: command.volume, min: 0, max: 1 })
        await mpv.set({ name: 'volume', value: Math.round(volume * 1000) / 10 })
        await mpv.set({ name: 'mute', value: command.muted })
        return OK
      }
      case 'speed':
        await mpv.set({ name: 'speed', value: clamp({ value: command.rate, min: 0.25, max: 4 }) })
        return OK
      case 'subtitleScale':
        await mpv.set({
          name: 'sub-scale',
          value: clamp({ value: command.scale, min: 0.5, max: 3 }),
        })
        return OK
      case 'stats':
        await mpv.command({ args: ['script-binding', 'stats/display-stats-toggle'] })
        return OK
      case 'stop':
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

  // Sent before anything else, so mpv applies it before any loadfile. It fails closed:
  // a failed set refuses every load.
  const harden = async (options: readonly MpvOption[]): Promise<boolean> => {
    const [first, ...rest] = options
    if (first === undefined) return true
    try {
      await mpv.set(first)
    } catch (error) {
      warn(`mpv set ${first.name} failed: ${messageOf(error)}`)
      return false
    }
    return harden(rest)
  }
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
    reset: async () => {
      if (phase === 'idle' || phase === 'dead') return
      await handle({ type: 'stop' })
    },
    applyOutput: async ({ output, devices }) => {
      if (phase === 'dead') return
      isVolumeFixed = isVolumeFixedFor(output)
      await setEach(outputOptions({ output, devices, canChooseAo }))
      if (phase !== 'loaded') return
      try {
        await mpv.command({ args: ['ao-reload'] })
      } catch (error) {
        warn(`mpv ao-reload failed: ${messageOf(error)}`)
      }
    },
    applyDisplay: async ({ refreshRate, edrHeadroom }) => {
      if (phase === 'dead') return
      await setEach(displayOptions({ refreshRate, edrHeadroom }))
    },
  }
}
