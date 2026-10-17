import { basename } from 'node:path'
import {
  isNumber,
  type OutputSettings,
  type PlayerCommand,
  type PlayerErrorReason,
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
import { type AudioDevice, ENGINE_STOPPED, isTrackIndex, SERVER_GONE } from '@/shared/protocol'
import { messageOf } from '@/shared/messageOf'

export type MpvControl = Pick<Mpv, 'command' | 'set' | 'read' | 'observe'>
export type PlayerOutcome =
  | { ok: true }
  | { ok: false; reason: PlayerRefusalReason; message: string }
export type PlayerActivity = { isPlaying: boolean; isShowing: boolean }

export const PLAYER_MESSAGES = {
  notOpen: 'That video is no longer open. Open it again from Home.',
  cannotOpen: 'raven player could not open this video.',
  stopped: 'raven player could not keep playing this video.',
  engineStopped: ENGINE_STOPPED,
  noTrack: 'That track is not in this video.',
  failed: 'raven player could not do that.',
  serverGone: SERVER_GONE,
  /** A server title's failure when the server could not say why; the source names the server when it can. */
  lost: 'raven player lost its connection to the server. Where you stopped last is saved there.',
} as const

/**
 * Sent with every server title. lavf must not follow a redirect, which would carry the
 * server's cookie to wherever it points (Ruling 14). mpv has lavf reconnect a dropped
 * stream after 0, 1, 3 and 7 s and gives every read 60 s: these keep 0, 1 and 3 s (a
 * Wi-Fi blip) and 15 s a read, so a server that went away stops its title about 4 s
 * after the last byte. One that hangs would cost seven reads (about 2 minutes), so the
 * service's stall budget (`SERVER_STALL_MS`) ends the title first.
 * `stream-lavf-o` is applied after mpv's own lavf defaults, so it overrides them.
 */
export const SERVER_LOAD_OPTIONS = {
  lavf: 'max_redirects=0,reconnect_delay_max=3',
  networkTimeout: 15,
} as const

/**
 * Options a server title carries on its own `loadfile`, never set globally: mpv reads
 * them as it opens a stream, not when a command is sent, so a global value set for the
 * next title could ride on the request of the one before. Per-file values also end with
 * their file, and a global set would override them.
 */
export const PER_FILE_OPTIONS = ['http-header-fields', 'stream-lavf-o', 'network-timeout'] as const

/**
 * Any way of naming a per-file option outside `loadfile`: itself, its list suffixes
 * (`-append`, `-set`, ...) and its `file-local-options/` or `options/` paths.
 */
const namesPerFileOption = (name: string): boolean =>
  PER_FILE_OPTIONS.some((option) => name.includes(option))

/**
 * mpv as the service reaches it: a per-file option set, changed or cycled by any route
 * but the `loadfile` options fails before mpv hears of it.
 */
export const guardedMpv = (mpv: MpvControl): MpvControl => ({
  ...mpv,
  set: async (option) => {
    if (namesPerFileOption(option.name)) {
      throw new Error(`${option.name} is set per file, never globally`)
    }
    await mpv.set(option)
  },
  command: async (input) => {
    const [name = ''] = input.args
    const named = name === 'loadfile' ? undefined : input.args.find(namesPerFileOption)
    if (named !== undefined) throw new Error(`${named} is set per file, never globally`)
    await mpv.command(input)
  },
})

/** How long a server title's first snapshot waits for its sidecars before it goes on. */
export const SIDECAR_BUDGET_MS = 3000

/**
 * How long a server title may wait on its server without the clock moving before the
 * service gives up on it. lavf's own timeouts and reconnects let a server that accepts
 * and then sends nothing hold the page for about two minutes.
 */
export const SERVER_STALL_MS = 30_000

export type ServerTarget = {
  kind: 'server'
  serverId: string
  mediaId: number
  url: string
  /** `Cookie: ...` from the server's own session, or '' when it holds none. */
  headerFields: string
  sidecars: readonly { url: string; title: string; language: string }[]
}
export type LoadTarget = { kind: 'file'; path: string } | ServerTarget
export type ResolvedSource = { ok: true; target: LoadTarget } | { ok: false; message: string }
export type FailureExplainer = (input: {
  target: ServerTarget
  phase: 'loading' | 'loaded'
}) => Promise<{ reason: PlayerErrorReason; message: string }>

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

/** What a warning says in place of the open file's path or name. */
const OPEN_FILE = '<file>'

export const resolveSourceWith =
  ({
    grants,
    servers,
  }: {
    grants: Pick<Grants, 'fileOf'>
    servers: {
      resolve: (source: Extract<PlayerSource, { kind: 'server' }>) => Promise<ResolvedSource>
    }
  }) =>
  async (source: PlayerSource): Promise<ResolvedSource> => {
    switch (source.kind) {
      case 'server':
        return servers.resolve(source)
      case 'file': {
        const file = grants.fileOf(source.fileId)
        if (file === null) return { ok: false, message: PLAYER_MESSAGES.notOpen }
        return { ok: true, target: { kind: 'file', path: file.path } }
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
  /** Stops a title from `serverId`, playing or still resolving, as that server goes away. */
  resetIfServer: (serverId: string) => Promise<void>
  /**
   * Forgets the title and every timer without telling mpv or the page, as its mpv is
   * destroyed, so no budget outlives the engine.
   */
  dispose: () => void
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

/** mpv's `%len%` quoting, so a value may hold `,` or `=` without ending the option. */
const quoted = (value: string): string => `%${new TextEncoder().encode(value).length}%${value}`

/**
 * The `loadfile` options for a target: where it starts, and for a server title its
 * cookie, the redirect and reconnect limits and the network timeout, which mpv applies
 * to this file alone (sidecars added while it plays included) and drops when it ends.
 */
const loadfileOptionsFor = ({ target, start }: { target: LoadTarget; start: number }): string => {
  switch (target.kind) {
    case 'file':
      return `start=${start}`
    case 'server':
      return [
        `start=${start}`,
        ...(target.headerFields === ''
          ? []
          : [`http-header-fields=${quoted(target.headerFields)}`]),
        `stream-lavf-o=${quoted(SERVER_LOAD_OPTIONS.lavf)}`,
        `network-timeout=${SERVER_LOAD_OPTIONS.networkTimeout}`,
      ].join(',')
    default: {
      const unreachable: never = target
      return unreachable
    }
  }
}

const locationOf = (target: LoadTarget): string => {
  switch (target.kind) {
    case 'file':
      return target.path
    case 'server':
      return target.url
    default: {
      const unreachable: never = target
      return unreachable
    }
  }
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
  mpv: unguarded,
  resolveSource,
  explain,
  canChooseAo,
  timers,
  serverStallMs = SERVER_STALL_MS,
  onActivity: reportActivity,
  onFirstFrame: reportFirstFrame,
  warn: reportWarning,
}: {
  mpv: MpvControl
  resolveSource: ReturnType<typeof resolveSourceWith>
  explain: FailureExplainer
  canChooseAo: boolean
  timers: Timers
  /** `SERVER_STALL_MS` unless a test needs it short. */
  serverStallMs?: number
  onActivity: (activity: PlayerActivity) => void
  onFirstFrame: () => void
  warn: (message: string) => void
}): PlayerService => {
  // What the newest load opened, and its ticket, which an ending explains and a server's
  // removal stops.
  let opened: LoadTarget | null = null
  // mpv's warnings name the file it plays, which the log must not hold (Ruling 12).
  const withoutOpenFile = (message: string): string => {
    if (opened === null || opened.kind !== 'file') return message
    const { path } = opened
    return message.replaceAll(path, OPEN_FILE).replaceAll(basename(path), OPEN_FILE)
  }
  // These run inside the wrapper's event drain, so nothing they throw may escape.
  const warn = (message: string) => {
    try {
      reportWarning(withoutOpenFile(message))
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
  // Bumped by every load and stop, and by a server going away, so a load still resolving
  // its source notices it was overtaken before it touches anything.
  let loadTicket = 0
  // The load still resolving a server's source, so that server going away can cancel it.
  let resolving: { ticket: number; serverId: string } | null = null
  let openedTicket = 0
  // Loads whose server went away while they resolved or waited on mpv: they answer that.
  let removedTickets: ReadonlySet<number> = new Set()
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
  let bufferedLatest: readonly Range[] | null = null
  let bufferedTimer: unknown = null
  let timeTimer: unknown = null
  let stallTimer: unknown = null
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

  /** What the newest load opened, when it is a server title. */
  const serverOpened = (): ServerTarget | null =>
    opened !== null && opened.kind === 'server' ? opened : null

  const clearStall = () => {
    if (stallTimer !== null) timers.clear(stallTimer)
    stallTimer = null
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
    clearStall()
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
    clearStall()
  }

  /** Whether the server owes the title something: still opening, or loaded and waiting. */
  const isOwed = () =>
    serverOpened() !== null && (phase === 'loading' || (phase === 'loaded' && isWaiting))

  /**
   * The server has kept a title opening, or loaded and waiting with its clock still, for
   * `serverStallMs`: the load ends as a lost connection, as a file that stops does. The
   * load itself was answered once mpv took its loadfile, so the page hears it here.
   */
  const onServerStalled = (token: number) => {
    stallTimer = null
    if (token !== epoch || !isOwed()) return
    stalledTickets = new Set([...stalledTickets, openedTicket])
    settleTo('idle')
    warn(`a server title waited ${serverStallMs} ms on its server, so it stops`)
    emit({ type: 'error', reason: 'network', message: PLAYER_MESSAGES.lost })
    onActivity({ isPlaying: false, isShowing: true })
    mpv.command({ args: ['stop'] }).catch((error: unknown) => {
      warn(`mpv stop failed: ${messageOf(error)}`)
    })
  }

  /** Starts the stall budget over while the server owes the title something; clears it otherwise. */
  const restartStall = () => {
    clearStall()
    if (!isOwed()) return
    const token = epoch
    stallTimer = timers.set(() => onServerStalled(token), serverStallMs)
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
    restartStall()
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

  /** Adds a server's sidecars one at a time, in order; false when overtaken. */
  const addSidecars = ({
    sidecars,
    token,
  }: {
    sidecars: ServerTarget['sidecars']
    token: number
  }): Promise<boolean> =>
    sidecars.reduce<Promise<boolean>>(async (chain, sidecar, position) => {
      if (!(await chain)) return false
      try {
        await mpv.command({
          args: ['sub-add', sidecar.url, 'auto', sidecar.title, sidecar.language],
        })
      } catch (error) {
        warn(`mpv sub-add of sidecar ${position} failed: ${messageOf(error)}`)
      }
      return token === epoch
    }, Promise.resolve(true))

  /**
   * Waits for a server title's sidecars, but no longer than `SIDECAR_BUDGET_MS`: a slow
   * server must not hold the first events back. Late sidecars still go in, in order, and
   * reach the page through `track-list`; `pending` is that chain when it outlasted the
   * budget, and `isCurrent` is false when the load was overtaken.
   */
  const sidecarsWithinBudget = async ({
    sidecars,
    token,
  }: {
    sidecars: ServerTarget['sidecars']
    token: number
  }): Promise<{ isCurrent: boolean; pending: Promise<boolean> | null }> => {
    const budget: { handle: unknown } = { handle: null }
    const late = new Promise<'late'>((resolve) => {
      budget.handle = timers.set(() => resolve('late'), SIDECAR_BUDGET_MS)
    })
    const adding = addSidecars({ sidecars, token })
    try {
      const outcome = await Promise.race([adding, late])
      if (outcome !== 'late') return { isCurrent: outcome && token === epoch, pending: null }
      warn('server sidecars are slow; the title starts without them')
      return { isCurrent: token === epoch, pending: adding }
    } finally {
      timers.clear(budget.handle)
    }
  }

  /**
   * The subtitle the load asked for may be a sidecar that came after the budget: once the
   * late sidecars are in, it is selected, unless the file changed or the page picked
   * another meanwhile, even one mpv has not answered yet.
   */
  const selectLateSubtitle = async ({
    pending,
    token,
    id,
  }: {
    pending: Promise<boolean>
    token: number
    id: string
  }) => {
    const picks = subtitlePicks
    const isWanted = () => token === epoch && subtitlePicks === picks && wanted.subtitle === id
    const isCurrent = await pending
    if (!isCurrent || !isWanted()) return
    const list = await readOr({ name: 'track-list', fallback: [] })
    if (!isWanted()) return
    const sid = sidFor({ list, id })
    if (sid === null) return
    await setQuietly({ name: 'sid', value: sid })
  }

  const snapshot = async (token: number) => {
    const server = serverOpened()
    const sidecars =
      server === null
        ? { isCurrent: true, pending: null }
        : await sidecarsWithinBudget({ sidecars: server.sidecars, token })
    if (!sidecars.isCurrent) return
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
    const paused = await readOr({ name: 'pause', fallback: false })
    const rate = await readOr({ name: 'speed', fallback: 1 })
    if (token !== epoch) return
    emit({ type: 'paused', paused })
    emit({ type: 'duration', duration })
    emit({ type: 'rate', rate })
    // The cache may have run dry while the sidecars were added; the budget goes on then.
    isWaiting = isPausedForCache || isSeeking
    restartStall()
    emit({ type: 'waiting', waiting: isWaiting })
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

  /**
   * An error the page hears: as it is for a file, or as the server explains it for a
   * server title, unless something newer overtook the ending while the server answered.
   */
  const emitFailure = ({
    failure,
    during,
  }: {
    failure: { reason: PlayerErrorReason; message: string }
    during: 'loading' | 'loaded'
  }) => {
    const asked = serverOpened()
    if (asked === null) {
      emit({ type: 'error', ...failure })
      return
    }
    const token = epoch
    const explainSafely = async () => {
      try {
        return await explain({ target: asked, phase: during })
      } catch (error) {
        warn(`player could not explain a server failure: ${messageOf(error)}`)
        return { reason: 'network', message: PLAYER_MESSAGES.lost } as const
      }
    }
    const report = async () => {
      const explained = await explainSafely()
      if (token !== epoch) return
      emit({ type: 'error', reason: explained.reason, message: explained.message })
    }
    report().catch((error: unknown) => {
      warn(`player could not report a server failure: ${messageOf(error)}`)
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
        emitFailure({
          failure: { reason: 'open', message: PLAYER_MESSAGES.cannotOpen },
          during: 'loading',
        })
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
      emitFailure({
        failure: { reason: 'decode', message: PLAYER_MESSAGES.stopped },
        during: 'loaded',
      })
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
      if (stallTimer !== null && time !== lastTime) restartStall()
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
        if (stallTimer !== null && event.data !== lastTime) restartStall()
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
    loadTicket += 1
    const ticket = loadTicket
    resolving =
      command.source.kind === 'server' ? { ticket, serverId: command.source.serverId } : null
    // What a load overtaken while it waits answers: its server going away or its stall
    // budget running out is a refusal the page can show, since nothing will play; an
    // engine stop is a failure, and a newer load or a stop is no failure of this one.
    const bail = () => {
      if (isDead()) return ENGINE_GONE
      if (removedTickets.has(ticket)) return refuse(PLAYER_MESSAGES.serverGone)
      if (stalledTickets.has(ticket)) return refuse(PLAYER_MESSAGES.lost)
      return OK
    }
    const resolved = await resolveSource(command.source).finally(() => {
      if (resolving !== null && resolving.ticket === ticket) resolving = null
    })
    // A newer load, a stop or the server going away while the source resolved: this load
    // touches nothing, as one overtaken while it waits on mpv sends no loadfile.
    if (ticket !== loadTicket || isDead()) return bail()
    if (!resolved.ok) return refuse(resolved.message)
    opened = resolved.target
    openedTicket = ticket
    phase = 'loading'
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
        settleTo('idle')
        onActivity({ isPlaying: false, isShowing: false })
        return refuse(PLAYER_MESSAGES.failed)
      }
      await mpv.set({ name: 'pause', value: false })
      // A stop, reset or newer load overtook this one: sending loadfile now would play
      // a file no page shows. A newer load or a stop is not a failure of this load, so
      // it answers ok; an engine that stopped meanwhile is, so the page can fall back.
      if (token !== generation) return bail()
      await mpv.command({
        args: [
          'loadfile',
          locationOf(resolved.target),
          'replace',
          '-1',
          loadfileOptionsFor({ target: resolved.target, start: loadStart }),
        ],
        onReply: ({ isOk }) => {
          if (isOk) answeredGeneration = Math.max(answeredGeneration, token)
        },
      })
      return bail()
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
    subtitlePicks += 1
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
    loadTicket += 1
    resolving = null
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

  const reset = async () => {
    if (phase === 'idle' || phase === 'dead') return
    await handle({ type: 'stop' })
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
    reset,
    // Latches as dead: the mpv behind it is destroyed, so no later load may arm a timer.
    dispose: () => {
      if (phase === 'dead') return
      loadTicket += 1
      resolving = null
      settleTo('dead')
    },
    resetIfServer: async (serverId) => {
      if (resolving !== null && resolving.serverId === serverId) {
        removedTickets = new Set([...removedTickets, resolving.ticket])
        loadTicket += 1
        resolving = null
      }
      if ((serverOpened()?.serverId ?? null) !== serverId) return
      if (phase !== 'loading' && phase !== 'loaded') return
      // A load still waiting is answered as refused; a title already playing has no answer
      // left to carry that, so the page hears it as an error.
      const isPlaying = phase === 'loaded'
      removedTickets = new Set([...removedTickets, openedTicket])
      // The stop takes its ticket before its first await; a load started while mpv
      // stops takes another, and its page must not hear of the gone server.
      const stopping = reset()
      const ticket = loadTicket
      await stopping
      if (isPlaying && ticket === loadTicket) {
        emit({ type: 'error', reason: 'open', message: PLAYER_MESSAGES.serverGone })
      }
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
