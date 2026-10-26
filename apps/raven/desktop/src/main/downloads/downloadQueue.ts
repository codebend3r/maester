import { AUTH_REFUSALS, DOWNLOAD_STATUS_KINDS } from '@raven/core'
import { unlessStopped } from '@/main/bounded'
import { SERVER_GONE, type ServerEntry } from '@/main/desktopConfig'
import {
  accountRefusedMessage,
  DOWNLOAD_MESSAGES,
  type AccountRefusal,
} from '@/main/downloads/downloadMessages'
import {
  advance,
  bytesOf,
  entryById,
  fail,
  finish,
  FAIL_REASONS,
  isWaitingOnOutage,
  PAUSE_REASONS,
  pause,
  pauseEverything,
  pauseServer,
  remove,
  removeAll,
  resume,
  sameGroup,
  setSidecars,
  start,
  type DownloadEntry,
  type FailReason,
  type PauseReason,
} from '@/main/downloads/downloadState'
import type { DownloadsStore } from '@/main/downloads/downloadStore'
import {
  FETCH_REASONS,
  fetchToFile,
  type FetchOutcome,
  type PartFile,
  type StreamFetch,
} from '@/main/downloads/fetchFile'
import {
  ACCESS_REFUSALS,
  fileUrlFor,
  type Access,
  type MediaAccess,
} from '@/main/downloads/mediaAccess'
import {
  downloadsDirFor,
  entryDirFor,
  fits,
  partPathFor,
  readSpace,
  videoPathFor,
  type SpaceFs,
} from '@/main/downloads/space'
import { createSidecarDownload } from '@/main/downloads/sidecarDownload'
import { removeFolder, sweepDownloads } from '@/main/downloads/sweep'
import { errorText } from '@/main/log/errorText'
import { loggable, type ServerCalls } from '@/main/servers/serverCalls'
import type { Timers } from '@/main/stateStore'
import { HTTP_STATUSES } from '@/shared/httpStatuses'

export const DOWNLOAD_CONCURRENCY = 2

/** How often the files waiting on an outage are tried again, while any waits. */
export const OUTAGE_RETRY_MS = 300_000

/** How long a wake from sleep is given for the network to come back before files start again. */
export const RESUME_SETTLE_MS = 5000

type RenameProps = { from: string; to: string }

type WriteFileProps = { path: string; text: string }

/** The parts of `node:fs/promises` the queue uses; main passes a recursive `mkdir` and a forced, recursive `rm`. */
export type QueueFs = {
  mkdir: (path: string) => Promise<void>
  rename: (input: RenameProps) => Promise<void>
  rm: (path: string) => Promise<void>
  readdir: (path: string) => Promise<string[]>
  openPart: (path: string) => Promise<PartFile>
  writeFile: (input: WriteFileProps) => Promise<void>
  /** A file's size, 0 when there is no such file. */
  size: (path: string) => Promise<number>
}

export type DownloadQueueDeps = {
  store: DownloadsStore
  serverOf: (serverId: string) => ServerEntry | null
  /** Every server Raven keeps, as the config holds them now. */
  servers: () => readonly ServerEntry[]
  access: MediaAccess
  /** A bare fetch with no cookie, `redirect: 'error'`: the ticket in the URL is the file's only key. */
  fetch: StreamFetch
  calls: Pick<ServerCalls, 'call'>
  fs: QueueFs
  space: SpaceFs
  userData: string
  timers: Timers
  now: () => number
  warn: (message: string) => void
  onFinished: (entry: DownloadEntry) => void
  onFailed: (entry: DownloadEntry) => void
  /** The downloads `remove` and `removeAll` dropped. */
  onRemoved: (entries: readonly DownloadEntry[]) => void
  /** A wake from sleep has settled: the network has had its moment. */
  onAwake: () => void
}

type PauseProps = { downloadId: string }

type ResumeProps = { downloadId: string }

type RetryProps = { downloadId: string }

type RemoveProps = { downloadId: string }

type SweepProps = { wasSetAside: boolean }

type AccessEndedProps = { serverId: string }

export type DownloadQueue = {
  /** Starts queued files, and files a last run left downloading, up to `DOWNLOAD_CONCURRENCY`. */
  kick: () => void
  pause: (input: PauseProps) => Promise<void>
  /** Requeues the file; a file paused by a relock requeues every file its server's relock paused. */
  resume: (input: ResumeProps) => void
  retry: (input: RetryProps) => void
  /** Requeues every file waiting on an outage and starts what can start: at launch, after the sweep. */
  retryOutages: () => void
  /** The computer is going to sleep: every fetch stops, its file left downloading, and none starts. */
  onSuspend: () => void
  /** The computer woke: files start again once `RESUME_SETTLE_MS` has passed. */
  onResume: () => void
  pauseAll: () => Promise<void>
  resumeAll: () => void
  /** Aborts the file, drops it and removes its folder. */
  remove: (input: RemoveProps) => Promise<void>
  /** Aborts every file, drops them all and removes the whole downloads folder. */
  removeAll: () => Promise<void>
  /** At launch: `sweepDownloads`, holding any kick until it is done. Never rejects. */
  sweep: (input: SweepProps) => Promise<void>
  /** The server's sign-in ended in main: its files fetched with an account ticket fail. */
  accessEnded: (input: AccessEndedProps) => void
  /** Aborts every fetch; the entries stay as they are for the next launch. */
  dispose: () => void
}

/** Why a run's fetch was aborted; each leaves the entry as the caller set it. */
const STOP_REASONS = {
  pause: 'pause',
  remove: 'remove',
  suspend: 'suspend',
  dispose: 'dispose',
  account: 'account',
} as const

type StopReason = (typeof STOP_REASONS)[keyof typeof STOP_REASONS]

// An AbortError, so `fetchToFile` reads a stopped fetch as aborted rather than unreachable.
const stopping = (reason: StopReason): DOMException => new DOMException(reason, 'AbortError')

/** Whether a run has read its account ticket, so an end of the sign-in it was read for ends it. */
const isAccountRun = ({ held }: Pick<Run, 'held'>): boolean => held.access !== null

const isUnderWay = ({ status }: DownloadEntry): boolean =>
  status.kind === DOWNLOAD_STATUS_KINDS.queued || status.kind === DOWNLOAD_STATUS_KINDS.downloading

const isRelocked = ({ status }: DownloadEntry): boolean =>
  status.kind === DOWNLOAD_STATUS_KINDS.paused && status.reason === PAUSE_REASONS.relocked

/** A file being fetched: `stop` aborts it, and `done` settles once it has let go of its files. */
type Run = {
  serverId: string
  stop: AbortController
  done: Promise<void>
  disk: RunDisk
  held: RunAccess
}

/** The access a run fetches with, once it has read one. */
type RunAccess = { access: Access | null }

/**
 * What a run's part holds, counted as it is written, and whether its space check has passed:
 * from then on, what it still lacks is room another file may not take.
 */
type RunDisk = { size: number; bytes: number; hasRoom: boolean }

/** What one file's run needs at every step. */
type Job = {
  entry: DownloadEntry
  server: ServerEntry
  signal: AbortSignal
  disk: RunDisk
  held: RunAccess
}

const lackedBy = ({ disk }: Run): number => (disk.hasRoom ? Math.max(disk.size - disk.bytes, 0) : 0)

type Failure = Extract<FetchOutcome, { ok: false }>

type IsResumableCutProps = { outcome: Failure; from: number }

/**
 * A response the server cut once the fetch had written past `from`, as it ends one whose account
 * lost access: a new ticket resumes it at once. One cut with nothing new is an outage.
 */
const isResumableCut = ({ outcome, from }: IsResumableCutProps): boolean =>
  outcome.reason === FETCH_REASONS.cut && outcome.bytes > from

/**
 * Fetches the queued files two at a time into `downloads/<serverId>/<mediaId>`, in the
 * state's order. Every step of a run checks whether it was stopped: a pause, a removal or
 * the app's quit has already set the entry as it should stay, so the run lets go and
 * changes nothing. A `.part` is removed only with its folder, never by a failure.
 */
export const createDownloadQueue = (deps: DownloadQueueDeps): DownloadQueue => {
  const { store, fs, userData, timers } = deps
  const running = new Map<string, Run>()
  let isDisposed = false
  /** The launch sweep while it runs: a kick meanwhile waits, so the sweep never takes a new file's folder. */
  const launch: { sweeping: Promise<void> | null } = { sweeping: null }
  /** How many times each server's sign-in has ended, so a ticket read across an end is not used. */
  let accessEnds: ReadonlyMap<string, number> = new Map()
  /** The one timer that tries the files waiting on an outage again. */
  const outage: { retry: unknown } = { retry: undefined }
  /** The files the outage retry requeued, until they fail, finish or the viewer acts on them. */
  const retried = new Set<string>()
  /** Asleep from a suspend until the settle after the wake; nothing starts meanwhile. */
  const sleep: { isAsleep: boolean; settle: unknown } = { isAsleep: false, settle: undefined }

  const partsOf = (entry: DownloadEntry) => ({
    userData,
    serverId: entry.serverId,
    mediaId: entry.mediaId,
    container: entry.container,
  })

  const told = (downloadId: string): void => {
    const entry = entryById(store.read(), { downloadId })
    const isRetried = retried.delete(downloadId)
    if (entry === null || entry.status.kind !== DOWNLOAD_STATUS_KINDS.failed) return
    // The outage was told when it began, and the row still says so.
    if (isRetried && entry.status.reason === FAIL_REASONS.unreachable) return
    deps.onFailed(entry)
  }

  type FailEntryProps = {
    entry: DownloadEntry
    reason: FailReason
    message?: string
  }

  const failEntry = ({ entry, reason, message }: FailEntryProps): void => {
    store.update((state) => fail(state, { downloadId: entry.downloadId, reason, message }))
    told(entry.downloadId)
  }

  type RunPickProps = { downloadId: string; run: Run }

  type RunPick = (input: RunPickProps) => boolean

  type StopRunsProps = {
    reason: StopReason
    isStopped: RunPick
  }

  const stopRuns = ({ reason, isStopped }: StopRunsProps): Promise<void> => {
    const stopped = [...running].filter(([downloadId, run]) => isStopped({ downloadId, run }))
    stopped.forEach(([, run]) => run.stop.abort(stopping(reason)))
    return Promise.all(stopped.map(([, run]) => run.done)).then(() => undefined)
  }

  /**
   * Writes what each picked run's part holds while its file is still downloading, before a
   * pause or a stop: progress is otherwise saved only every `PROGRESS_STEP_BYTES`.
   */
  const saveBytes = (isSaved: RunPick): void => {
    const saved = [...running].filter(([downloadId, run]) => isSaved({ downloadId, run }))
    store.update((state) =>
      saved.reduce(
        (next, [downloadId, run]) => advance(next, { downloadId, bytes: run.disk.bytes }),
        state,
      ),
    )
  }

  /**
   * The disk is full: this file fails, and the files of its group still waiting wait paused,
   * a run already reading one's ticket stopped with it.
   */
  const failForSpace = (entry: DownloadEntry): void => {
    const waiting = store
      .read()
      .entries.filter(
        (other) =>
          other.downloadId !== entry.downloadId &&
          other.status.kind === DOWNLOAD_STATUS_KINDS.queued &&
          sameGroup({ a: entry, b: other }),
      )
      .map(({ downloadId }) => downloadId)
    store.update((state) =>
      waiting.reduce(
        (next, downloadId) => pause(next, { downloadId, reason: PAUSE_REASONS.noSpace }),
        fail(state, { downloadId: entry.downloadId, reason: FAIL_REASONS.noSpace }),
      ),
    )
    stopRuns({
      reason: STOP_REASONS.pause,
      isStopped: ({ downloadId }) => waiting.includes(downloadId),
    }).catch(() => undefined)
    told(entry.downloadId)
  }

  type PauseServerOfProps = { job: Job; reason: PauseReason }

  /** Every other waiting or running file of the job's server waits paused for `reason`. */
  const pauseServerOf = ({ job, reason }: PauseServerOfProps): void => {
    const { entry, server } = job
    saveBytes(({ run }) => run.serverId === server.id)
    store.update((state) => pauseServer(state, { serverId: server.id, reason }))
    stopRuns({
      reason: STOP_REASONS.pause,
      isStopped: ({ downloadId, run }) =>
        run.serverId === server.id && downloadId !== entry.downloadId,
    }).catch(() => undefined)
  }

  /** The server locked its library again: every file of it waits paused, running ones too. */
  const relock = (job: Job): void => {
    pauseServerOf({ job, reason: PAUSE_REASONS.relocked })
    deps.warn(`${loggable(job.server.name)} locked ${loggable(job.entry.label)}'s library again`)
  }

  /**
   * The server could not be reached: this file fails, its part kept, and the rest of the
   * server's files wait paused, so an outage costs one failure rather than the whole queue.
   */
  const failUnreachable = (job: Job): void => {
    failEntry({ entry: job.entry, reason: FAIL_REASONS.unreachable })
    pauseServerOf({ job, reason: PAUSE_REASONS.unreachable })
    syncOutageRetry()
    deps.warn(`Raven could not reach ${loggable(job.server.name)} for ${loggable(job.entry.label)}`)
  }

  type FailRunsProps = {
    downloadIds: readonly string[]
    message: string
  }

  /** Fails each of `downloadIds` with `message`, its bytes kept, and stops the ones that run. */
  const failRuns = ({ downloadIds, message }: FailRunsProps): void => {
    const isPicked: RunPick = ({ downloadId }) => downloadIds.includes(downloadId)
    saveBytes(isPicked)
    store.update((state) =>
      downloadIds.reduce(
        (next, downloadId) => fail(next, { downloadId, reason: FAIL_REASONS.other, message }),
        state,
      ),
    )
    stopRuns({ reason: STOP_REASONS.account, isStopped: isPicked }).catch(() => undefined)
  }

  type FailAccountProps = { job: Job; message: string }

  /**
   * The server refused the account: this file fails with why, and so do the files of its group
   * still under way, which would meet the same refusal. Main reads the account again, so the page
   * hears it; the files told of are this one alone.
   */
  const failAccount = ({ job, message }: FailAccountProps): void => {
    const { entry, server } = job
    const group = store
      .read()
      .entries.filter(
        (other) =>
          other.downloadId !== entry.downloadId &&
          isUnderWay(other) &&
          sameGroup({ a: entry, b: other }),
      )
      .map(({ downloadId }) => downloadId)
    group.forEach((downloadId) => retried.delete(downloadId))
    failRuns({ downloadIds: [entry.downloadId, ...group], message })
    told(entry.downloadId)
    deps.warn(`${loggable(server.name)} refused the account for ${loggable(entry.label)}`)
  }

  type FailAccountForProps = { job: Job; reason: AccountRefusal }

  const failAccountFor = ({ job, reason }: FailAccountForProps): void =>
    failAccount({
      job,
      message: accountRefusedMessage({ reason, serverName: job.server.name }),
    })

  const endsOf = (serverId: string): number => accessEnds.get(serverId) ?? 0

  /** A new access, or null once the file has been failed or paused for why there is none. */
  const accessOf = async (job: Job): Promise<Access | null> => {
    const { entry, server, signal } = job
    const ends = endsOf(server.id)
    const outcome = await unlessStopped({
      task: deps.access.accessFor({ serverId: entry.serverId, mediaId: entry.mediaId, signal }),
      signal,
    })
    if (outcome === null || signal.aborted) return null
    if (outcome.ok) {
      // The sign-in this ticket was read for has ended since: the file waits for the next one.
      if (endsOf(server.id) !== ends) {
        failRuns({
          downloadIds: [entry.downloadId],
          message: DOWNLOAD_MESSAGES.signInAgain(server.name),
        })
        told(entry.downloadId)
        return null
      }
      job.held.access = outcome.access
      return outcome.access
    }
    switch (outcome.reason) {
      case ACCESS_REFUSALS.locked:
        relock(job)
        return null
      case ACCESS_REFUSALS.unreachable:
        failUnreachable(job)
        return null
      case ACCESS_REFUSALS.gone:
        failEntry({ entry, reason: FAIL_REASONS.gone })
        return null
      case ACCESS_REFUSALS.account:
        failAccount({ job, message: outcome.message })
        return null
      default: {
        const unreachable: never = outcome.reason
        return unreachable
      }
    }
  }

  type FetchOnceProps = {
    job: Job
    access: Access
    signal: AbortSignal
  }

  const fetchOnce = async ({
    job,
    access,
    signal,
  }: FetchOnceProps): Promise<{ outcome: FetchOutcome; from: number }> => {
    const { entry, disk } = job
    /** What the part held when the fetch last asked: its `Range`, so a cut can tell it made progress. */
    const asked = { bytes: disk.bytes }
    // `bytes` is advisory, for the views, so it may be stored mid-stream: every resume reads
    // `part.size()` for its `Range` and corrects it.
    const onDisk = (bytes: number): void =>
      store.update((state) => advance(state, { downloadId: entry.downloadId, bytes }))
    const part = await fs.openPart(partPathFor(partsOf(entry)))
    const outcome = await fetchToFile({
      fetch: deps.fetch,
      url: fileUrlFor({ access, mediaId: entry.mediaId }),
      // The run counts every byte as it lands; a resumed row shows the bytes already on disk at
      // once, not from the first progress step.
      part: {
        ...part,
        size: async () => {
          const bytes = await part.size()
          disk.bytes = bytes
          asked.bytes = bytes
          onDisk(bytes)
          return bytes
        },
        append: async (chunk) => {
          await part.append(chunk)
          disk.bytes += chunk.length
        },
        truncate: async () => {
          await part.truncate()
          disk.bytes = 0
        },
      },
      expectedSize: entry.size,
      signal,
      timers,
      now: deps.now,
      onProgress: onDisk,
    })
    return { outcome, from: asked.bytes }
  }

  type SettleFailureProps = { job: Job; outcome: Failure }

  /** Fails or pauses the file for why its fetch stopped short. */
  const settleFailure = ({ job, outcome }: SettleFailureProps): void => {
    const { entry, server } = job
    switch (outcome.reason) {
      case FETCH_REASONS.locked:
        relock(job)
        return
      case FETCH_REASONS.space:
        failForSpace(entry)
        return
      case FETCH_REASONS.changed:
        failEntry({ entry, reason: FAIL_REASONS.changed })
        return
      case FETCH_REASONS.unreachable:
      case FETCH_REASONS.cut:
      case FETCH_REASONS.stalled:
      case FETCH_REASONS.aborted:
        // The origin picked may be the one that went away; the next file probes again.
        deps.access.forget(server.id)
        failUnreachable(job)
        return
      // A ticket refused again, or refused outright, is the account's refusal: the reason its
      // body gives, or the one its status stands for.
      case FETCH_REASONS.unauthorized:
        failAccountFor({ job, reason: outcome.refusal ?? AUTH_REFUSALS.signedOut })
        return
      case FETCH_REASONS.status: {
        const status = outcome.status ?? 0
        if (status === HTTP_STATUSES.forbidden) {
          failAccountFor({ job, reason: outcome.refusal ?? AUTH_REFUSALS.revoked })
          return
        }
        // A proxy in front of a restarting server answers 502 to 504: an outage, not a refusal.
        if (status >= 500) {
          deps.access.forget(server.id)
          failUnreachable(job)
          return
        }
        if (status === HTTP_STATUSES.notFound) {
          failEntry({ entry, reason: FAIL_REASONS.gone })
          return
        }
        failEntry({
          entry,
          reason: FAIL_REASONS.other,
          message: DOWNLOAD_MESSAGES.answered({ serverName: server.name, status }),
        })
        return
      }
      default: {
        const unreachable: never = outcome.reason
        return unreachable
      }
    }
  }

  type FetchVideoProps = {
    job: Job
    access: Access
    hasRetried: boolean
  }

  /**
   * Fetches the video into its `.part` and answers the access it ended with, or null once the
   * file has been failed, paused or stopped. A 401 or 423 reads a new access once before it
   * counts, and a response cut after progress reads one more at once.
   */
  const fetchVideo = async ({
    job,
    access,
    hasRetried,
  }: FetchVideoProps): Promise<Access | null> => {
    const { entry, signal } = job
    const { outcome, from } = await fetchOnce({ job, access, signal })
    if (signal.aborted) return null
    if (outcome.ok) return access
    // The part is closed now, so the bytes it holds can be kept.
    store.update((state) => advance(state, { downloadId: entry.downloadId, bytes: outcome.bytes }))
    const isRefused =
      outcome.reason === FETCH_REASONS.unauthorized || outcome.reason === FETCH_REASONS.locked
    const isRetry = isRefused && !hasRetried
    if (!isRetry && !isResumableCut({ outcome, from })) {
      settleFailure({ job, outcome })
      return null
    }
    const next = await accessOf(job)
    if (next === null) return null
    // A cut keeps the retry it had, so cuts between 401s never hide a refusal.
    return fetchVideo({ job, access: next, hasRetried: hasRetried || isRetry })
  }

  const sidecarsFor = createSidecarDownload({
    calls: deps.calls,
    fetch: deps.fetch,
    fs,
    userData,
    timers,
    warn: (message) => deps.warn(message),
  })

  type WorkProps = {
    downloadId: string
    signal: AbortSignal
    disk: RunDisk
    held: RunAccess
  }

  /** One file, from the space check to `ready`. */
  const work = async ({ downloadId, signal, disk, held }: WorkProps): Promise<void> => {
    const entry = entryById(store.read(), { downloadId })
    if (entry === null) return
    const server = deps.serverOf(entry.serverId)
    if (server === null) {
      failEntry({ entry, reason: FAIL_REASONS.other, message: SERVER_GONE })
      return
    }
    const job: Job = { entry, server, signal, disk, held }
    // A crash between the rename and the next save leaves the video whole and the file not ready.
    const whole = await fs.size(videoPathFor(partsOf(entry)))
    if (signal.aborted) return
    if (whole === entry.size) {
      store.update((state) => finish(state, { downloadId }))
      announceReady(downloadId)
      return
    }
    const { free } = await readSpace({ fs: deps.space, dir: downloadsDirFor({ userData }) })
    // A resumed or retried file needs only what its part lacks, whatever its status says.
    const onDisk = await fs.size(partPathFor(partsOf(entry)))
    if (signal.aborted) return
    // Checked and claimed in one turn, so two runs never both count on the same room.
    const claimed = [...running.values()].reduce((sum, run) => sum + lackedBy(run), 0)
    if (!fits({ bytes: entry.size - onDisk, free: free - claimed })) {
      failForSpace(entry)
      return
    }
    disk.bytes = onDisk
    disk.hasRoom = true
    const access = await accessOf(job)
    if (access === null) return
    store.update((state) => start(state, { downloadId }))
    // A pause or a failure that came while the ticket was read stands, and this run lets go.
    if (
      (entryById(store.read(), { downloadId })?.status.kind ?? null) !==
      DOWNLOAD_STATUS_KINDS.downloading
    )
      return
    await fs.mkdir(entryDirFor(partsOf(entry)))
    if (signal.aborted) return
    // The server checks an account ticket when each request starts and keeps it five minutes, so
    // the subtitles go first, on the run's fresh ticket, before a long video outlives it.
    const sidecars = await sidecarsFor({ job, access })
    if (signal.aborted) return
    const fetched = await fetchVideo({ job, access, hasRetried: false })
    if (fetched === null) return
    if (signal.aborted) return
    await fs.rename({
      from: partPathFor(partsOf(entry)),
      to: videoPathFor(partsOf(entry)),
    })
    // The video is in place, so the file is ready whatever was asked of it meanwhile.
    store.update((state) => finish(setSidecars(state, { downloadId, sidecars }), { downloadId }))
    announceReady(downloadId)
  }

  const announceReady = (downloadId: string): void => {
    retried.delete(downloadId)
    const ready = entryById(store.read(), { downloadId })
    if (ready !== null) deps.onFinished(ready)
  }

  const begin = (entry: DownloadEntry): void => {
    const { downloadId } = entry
    const stop = new AbortController()
    const settled = Promise.withResolvers<void>()
    const disk: RunDisk = { size: entry.size, bytes: bytesOf(entry), hasRoom: false }
    const held: RunAccess = { access: null }
    running.set(downloadId, { serverId: entry.serverId, stop, done: settled.promise, disk, held })
    work({ downloadId, signal: stop.signal, disk, held })
      .catch((error: unknown) => {
        if (stop.signal.aborted) return
        failEntry({ entry, reason: FAIL_REASONS.other, message: errorText(error) })
        deps.warn(`Raven could not download ${loggable(entry.label)}`)
      })
      .finally(() => {
        running.delete(downloadId)
        settled.resolve()
        kick()
      })
      .catch((error: unknown) => {
        deps.warn(`Raven's downloads stopped short: ${loggable(errorText(error))}`)
      })
  }

  const kick = (): void => {
    if (isDisposed || sleep.isAsleep) return
    if (launch.sweeping !== null) {
      launch.sweeping.then(kick).catch((error: unknown) => {
        deps.warn(`Raven's downloads stopped short: ${loggable(errorText(error))}`)
      })
      return
    }
    const slots = DOWNLOAD_CONCURRENCY - running.size
    if (slots <= 0) return
    const isIdle = (entry: DownloadEntry): boolean => !running.has(entry.downloadId)
    const { entries } = store.read()
    // A file left downloading by the last run goes first: it was under way.
    const resumed = entries.filter(
      (entry) => entry.status.kind === DOWNLOAD_STATUS_KINDS.downloading && isIdle(entry),
    )
    const queued = entries.filter(
      (entry) => entry.status.kind === DOWNLOAD_STATUS_KINDS.queued && isIdle(entry),
    )
    const next = [...resumed, ...queued].slice(0, slots)
    next.forEach(begin)
  }

  type StopOneProps = { downloadId: string; reason: StopReason }

  const stopOne = ({ downloadId, reason }: StopOneProps) =>
    stopRuns({ reason, isStopped: (candidate) => candidate.downloadId === downloadId })

  const pauseOne: DownloadQueue['pause'] = async ({ downloadId }) => {
    saveBytes((candidate) => candidate.downloadId === downloadId)
    store.update((state) => pause(state, { downloadId, reason: PAUSE_REASONS.viewer }))
    await stopOne({ downloadId, reason: STOP_REASONS.pause })
    kick()
  }

  const clearOutageRetry = (): void => {
    timers.clear(outage.retry)
    outage.retry = undefined
  }

  /** Arms the outage retry while any file waits on an outage, and drops it once none does. */
  const syncOutageRetry = (): void => {
    if (isDisposed || !store.read().entries.some(isWaitingOnOutage)) {
      clearOutageRetry()
      return
    }
    if (outage.retry !== undefined) return
    outage.retry = timers.set({
      run: () => {
        outage.retry = undefined
        retryOutages()
      },
      ms: OUTAGE_RETRY_MS,
    })
  }

  type ResumeEachProps = {
    downloadIds: readonly string[]
    isRetry: boolean
  }

  const resumeEach = ({ downloadIds, isRetry }: ResumeEachProps): void => {
    downloadIds.forEach((downloadId) =>
      isRetry ? retried.add(downloadId) : retried.delete(downloadId),
    )
    store.update((state) =>
      downloadIds.reduce((next, downloadId) => resume(next, { downloadId }), state),
    )
    syncOutageRetry()
    kick()
  }

  const retryOutages: DownloadQueue['retryOutages'] = () => {
    if (isDisposed) return
    resumeEach({
      downloadIds: store
        .read()
        .entries.filter(isWaitingOnOutage)
        .map(({ downloadId }) => downloadId),
      isRetry: true,
    })
  }

  // One unlock lifts the lock for every file of the server, so one Resume takes them all.
  const resumeOne: DownloadQueue['resume'] = ({ downloadId }) => {
    const entry = entryById(store.read(), { downloadId })
    if (entry === null) return
    const relocked = isRelocked(entry)
      ? store
          .read()
          .entries.filter((other) => other.serverId === entry.serverId && isRelocked(other))
      : [entry]
    resumeEach({ downloadIds: relocked.map((other) => other.downloadId), isRetry: false })
  }

  const retryOne: DownloadQueue['retry'] = ({ downloadId }) =>
    resumeEach({ downloadIds: [downloadId], isRetry: false })

  const pauseAll: DownloadQueue['pauseAll'] = async () => {
    saveBytes(() => true)
    store.update(pauseEverything)
    syncOutageRetry()
    await stopRuns({ reason: STOP_REASONS.pause, isStopped: () => true })
  }

  const resumeAll: DownloadQueue['resumeAll'] = () => {
    resumeEach({
      downloadIds: store
        .read()
        .entries.filter((entry) => entry.status.kind === DOWNLOAD_STATUS_KINDS.paused)
        .map(({ downloadId }) => downloadId),
      isRetry: false,
    })
  }

  const onSuspend: DownloadQueue['onSuspend'] = () => {
    if (isDisposed) return
    sleep.isAsleep = true
    timers.clear(sleep.settle)
    sleep.settle = undefined
    saveBytes(() => true)
    stopRuns({ reason: STOP_REASONS.suspend, isStopped: () => true }).catch(() => undefined)
  }

  const onResume: DownloadQueue['onResume'] = () => {
    if (isDisposed) return
    timers.clear(sleep.settle)
    sleep.settle = timers.set({
      run: () => {
        sleep.settle = undefined
        sleep.isAsleep = false
        // A wake may come on another network, so each server's origin is picked again.
        deps.servers().forEach(({ id }) => deps.access.forget(id))
        retryOutages()
        deps.onAwake()
      },
      ms: RESUME_SETTLE_MS,
    })
  }

  type RemovingProps = { path: string; what: string }

  const removing = ({ path, what }: RemovingProps): Promise<void> =>
    removeFolder({ fs, warn: deps.warn, path, what })

  const removeOne: DownloadQueue['remove'] = async ({ downloadId }) => {
    const entry = entryById(store.read(), { downloadId })
    if (entry === null) return
    store.update((state) => remove(state, { downloadId }))
    deps.onRemoved([entry])
    syncOutageRetry()
    await stopOne({ downloadId, reason: STOP_REASONS.remove })
    await removing({
      path: entryDirFor(partsOf(entry)),
      what: `the files of ${loggable(entry.label)}`,
    })
    kick()
  }

  const removeEverything: DownloadQueue['removeAll'] = async () => {
    const dropped = store.read().entries
    store.update(removeAll)
    if (dropped.length > 0) deps.onRemoved(dropped)
    syncOutageRetry()
    await stopRuns({ reason: STOP_REASONS.remove, isStopped: () => true })
    await removing({ path: downloadsDirFor({ userData }), what: 'its downloads' })
  }

  const accessEnded: DownloadQueue['accessEnded'] = ({ serverId }) => {
    if (isDisposed) return
    accessEnds = new Map([...accessEnds, [serverId, endsOf(serverId) + 1]])
    const server = deps.serverOf(serverId)
    // Another server's downloads are fetched no more, so none of them runs.
    if (server === null) return
    const ended = [...running]
      .filter(([downloadId, run]) => {
        const entry = entryById(store.read(), { downloadId })
        return run.serverId === serverId && isAccountRun(run) && entry !== null && isUnderWay(entry)
      })
      .map(([downloadId]) => downloadId)
    if (ended.length === 0) return
    failRuns({ downloadIds: ended, message: DOWNLOAD_MESSAGES.signInAgain(server.name) })
    ended.forEach(told)
    deps.warn(`Raven stopped downloading from ${loggable(server.name)}: its sign-in ended`)
  }

  const dispose: DownloadQueue['dispose'] = () => {
    saveBytes(() => true)
    isDisposed = true
    clearOutageRetry()
    timers.clear(sleep.settle)
    sleep.settle = undefined
    running.forEach((run) => run.stop.abort(stopping(STOP_REASONS.dispose)))
  }

  return {
    kick,
    pause: pauseOne,
    resume: resumeOne,
    retry: retryOne,
    retryOutages,
    onSuspend,
    onResume,
    pauseAll,
    resumeAll,
    remove: removeOne,
    removeAll: removeEverything,
    accessEnded,
    sweep: ({ wasSetAside }) => {
      const sweeping = sweepDownloads({
        store,
        fs,
        userData,
        warn: deps.warn,
        wasSetAside,
      }).finally(() => {
        launch.sweeping = null
      })
      launch.sweeping = sweeping
      return sweeping
    },
    dispose,
  }
}
