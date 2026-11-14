import { DOWNLOAD_STATUS_KINDS } from '@raven/core'
import { unlessStopped } from '@/main/bounded'
import { SERVER_GONE, SERVER_NAME } from '@/main/desktopConfig'
import {
  advance,
  bytesOf,
  entryById,
  FAIL_REASONS,
  finish,
  isRelocked,
  isUnderWay,
  isWaitingOnOutage,
  PAUSE_REASONS,
  pause,
  pauseEverything,
  remove,
  removeAll,
  resume,
  setSidecars,
  start,
  type DownloadEntry,
} from '@/main/downloads/downloadState'
import type { DownloadsStore } from '@/main/downloads/downloadStore'
import {
  FETCH_REASONS,
  fetchToFile,
  type FetchOutcome,
  type PartFile,
  type StreamFetch,
} from '@/main/downloads/fetchFile'
import { fileUrlFor, type Access, type MediaAccess } from '@/main/downloads/mediaAccess'
import { createQueueFailures } from '@/main/downloads/queueFailures'
import { createQueueRuns, EVERY_RUN, type RunDisk, runOf } from '@/main/downloads/queueRuns'
import { createQueueSchedule } from '@/main/downloads/queueSchedule'
import {
  downloadsDirFor,
  entryDirFor,
  fits,
  partPathFor,
  readSpace,
  mediaPathFor,
  type SpaceFs,
} from '@/main/downloads/space'
import { createSidecarDownload } from '@/main/downloads/sidecarDownload'
import { removeFolder, sweepDownloads } from '@/main/downloads/sweep'
import { errorText } from '@/main/log/errorText'
import { loggable, type ServerCalls } from '@/main/servers/serverCalls'
import type { Timers } from '@/main/timers'

export const DOWNLOAD_CONCURRENCY = 2

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
  /** The id the server's downloads are filed under; a download of any other is no longer fetched. */
  serverId: string
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

type ById = { downloadId: string }

type SweepProps = { wasSetAside: boolean }

export type DownloadQueue = {
  /** Starts queued files, and files a last run left downloading, up to `DOWNLOAD_CONCURRENCY`. */
  kick: () => void
  pause: (input: ById) => Promise<void>
  /** Requeues the file; a file paused by a relock requeues every file the relock paused. */
  resume: (input: ById) => void
  retry: (input: ById) => void
  /** Requeues every file waiting on an outage and starts what can start: at launch, after the sweep. */
  retryOutages: () => void
  /** The computer is going to sleep: every fetch stops, its file left downloading, and none starts. */
  onSuspend: () => void
  /** The computer woke: files start again once `RESUME_SETTLE_MS` has passed. */
  onResume: () => void
  pauseAll: () => Promise<void>
  resumeAll: () => void
  /** Aborts the file, drops it and removes its folder. */
  remove: (input: ById) => Promise<void>
  /** Aborts every file, drops them all and removes the whole downloads folder. */
  removeAll: () => Promise<void>
  /** At launch: `sweepDownloads`, holding any kick until it is done. Never rejects. */
  sweep: (input: SweepProps) => Promise<void>
  /** The page's sign-in ended in main: its files fetched with an account ticket fail. */
  accessEnded: () => void
  /** Aborts every fetch; the entries stay as they are for the next launch. */
  dispose: () => void
}

/** What one file's run needs at every step. */
type Job = {
  entry: DownloadEntry
  signal: AbortSignal
  disk: RunDisk
  /** Marks the run as one that read its account ticket. */
  onAccess: () => void
}

type Failure = Extract<FetchOutcome, { ok: false }>

type IsResumableCutProps = { outcome: Failure; from: number }

/**
 * A response the server cut once the fetch had written past `from`, as it ends one whose account
 * lost access: a new ticket resumes it at once. One cut with nothing new is an outage.
 */
const isResumableCut = ({ outcome, from }: IsResumableCutProps): boolean =>
  outcome.reason === FETCH_REASONS.cut && outcome.bytes > from

/** A refusal a fetch reads a new access for once before it counts. */
const isRetriedRefusal = ({ reason }: Failure): boolean =>
  reason === FETCH_REASONS.unauthorized || reason === FETCH_REASONS.locked

type FetchedOnce = { outcome: FetchOutcome; from: number }

/**
 * Fetches the queued files two at a time into `downloads/<serverId>/<mediaId>`, in the
 * state's order. Every step of a run checks whether it was stopped: a pause, a removal or
 * the app's quit has already set the entry as it should stay, so the run lets go and
 * changes nothing. A `.part` is removed only with its folder, never by a failure.
 */
export const createDownloadQueue = (deps: DownloadQueueDeps): DownloadQueue => {
  const { store, fs, userData, timers } = deps
  const runs = createQueueRuns(store)
  let isDisposed = false
  /** The launch sweep while it runs: a kick meanwhile waits, so the sweep never takes a new file's folder. */
  let sweeping: Promise<void> | null = null
  /** How many times the sign-in has ended, so a ticket read across an end is not used. */
  let accessEnds = 0
  /** The files the outage retry requeued, until they fail, finish or the viewer acts on them. */
  const retried = new Set<string>()

  const schedule = createQueueSchedule({
    store,
    timers,
    onRetry: () => retryOutages(),
    onAwake: () => {
      // A wake may come on another network, so the origin is picked again.
      deps.access.forget()
      retryOutages()
      deps.onAwake()
    },
  })

  const failures = createQueueFailures({
    store,
    runs,
    retried,
    forgetOrigin: () => deps.access.forget(),
    onOutage: () => schedule.syncOutageRetry(),
    onFailed: deps.onFailed,
    warn: deps.warn,
  })

  const partsOf = (entry: DownloadEntry) => ({
    userData,
    serverId: entry.serverId,
    mediaId: entry.mediaId,
    container: entry.container,
  })

  /** A new access, or null once the file has been failed or paused for why there is none. */
  const accessOf = async (job: Job): Promise<Access | null> => {
    const { entry, signal } = job
    const ends = accessEnds
    const outcome = await unlessStopped({
      task: deps.access.accessFor({ mediaId: entry.mediaId, signal }),
      signal,
    })
    if (outcome === null || signal.aborted) return null
    if (!outcome.ok) {
      failures.settleAccess({ entry, refusal: outcome })
      return null
    }
    // The sign-in this ticket was read for has ended since: the file waits for the next one.
    if (accessEnds !== ends) {
      failures.failSignedOut([entry.downloadId])
      return null
    }
    job.onAccess()
    return outcome.access
  }

  type FetchOnceProps = { job: Job; access: Access }

  const fetchOnce = async ({ job, access }: FetchOnceProps): Promise<FetchedOnce> => {
    const { entry, disk, signal } = job
    /** What the part held when the fetch last asked: its `Range`, so a cut can tell it made progress. */
    const asked = { bytes: disk.bytes }
    /*
     * `bytes` is advisory, for the views, so it may be stored mid-stream: every resume reads
     * `part.size()` for its `Range` and corrects it.
     */
    const onDisk = (bytes: number): void =>
      store.update((state) => advance({ state, downloadId: entry.downloadId, bytes }))
    const part = await fs.openPart(partPathFor(partsOf(entry)))
    const outcome = await fetchToFile({
      fetch: deps.fetch,
      url: fileUrlFor({ access, mediaId: entry.mediaId }),
      /*
       * The run counts every byte as it lands; a resumed row shows the bytes already on disk at
       * once, not from the first progress step.
       */
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

  type FetchVideoProps = { job: Job; access: Access; hasRetried: boolean }

  /**
   * Fetches the video into its `.part` and answers whether it is whole; false once the file has
   * been failed, paused or stopped. A 401 or 423 reads a new access once before it counts, and a
   * response cut after progress reads one more at once.
   */
  const fetchVideo = async ({ job, access, hasRetried }: FetchVideoProps): Promise<boolean> => {
    const { entry, signal } = job
    const { outcome, from } = await fetchOnce({ job, access })
    if (signal.aborted) return false
    if (outcome.ok) return true
    // The part is closed now, so the bytes it holds can be kept.
    store.update((state) => advance({ state, downloadId: entry.downloadId, bytes: outcome.bytes }))
    const isRetry = isRetriedRefusal(outcome) && !hasRetried
    if (!isRetry && !isResumableCut({ outcome, from })) {
      failures.settleFetch({ entry, outcome })
      return false
    }
    const next = await accessOf(job)
    if (next === null) return false
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

  const announceReady = (downloadId: string): void => {
    retried.delete(downloadId)
    const ready = entryById({ state: store.read(), downloadId })
    if (ready !== null) deps.onFinished(ready)
  }

  type ClaimRoomProps = Pick<Job, 'entry' | 'signal' | 'disk'>

  /**
   * Claims the room a file still lacks, true once claimed. A resumed or retried file needs only
   * what its part lacks, whatever its status says. Checked and claimed in one turn, so two runs
   * never both count on the same room.
   */
  const claimRoom = async ({ entry, signal, disk }: ClaimRoomProps): Promise<boolean> => {
    const [{ free }, onDisk] = await Promise.all([
      readSpace({ fs: deps.space, dir: downloadsDirFor({ userData }) }),
      fs.size(partPathFor(partsOf(entry))),
    ])
    if (signal.aborted) return false
    if (!fits({ bytes: entry.size - onDisk, free: free - runs.claimed() })) {
      failures.failForSpace(entry)
      return false
    }
    disk.bytes = onDisk
    disk.hasRoom = true
    return true
  }

  /** One file, from the space check to `ready`. */
  const work = async (job: Job): Promise<void> => {
    const { entry, signal } = job
    const { downloadId } = entry
    if (entry.serverId !== deps.serverId) {
      failures.failEntry({ entry, failure: { reason: FAIL_REASONS.other, message: SERVER_GONE } })
      return
    }
    // A crash between the rename and the next save leaves the video whole and the file not ready.
    const whole = await fs.size(mediaPathFor(partsOf(entry)))
    if (signal.aborted) return
    if (whole === entry.size) {
      store.update((state) => finish({ state, downloadId }))
      announceReady(downloadId)
      return
    }
    if (!(await claimRoom(job))) return
    const access = await accessOf(job)
    if (access === null) return
    store.update((state) => start({ state, downloadId }))
    // A pause or a failure that came while the ticket was read stands, and this run lets go.
    const started = entryById({ state: store.read(), downloadId })
    if (started === null || started.status.kind !== DOWNLOAD_STATUS_KINDS.downloading) return
    await fs.mkdir(entryDirFor(partsOf(entry)))
    if (signal.aborted) return
    /*
     * The server checks an account ticket when each request starts and keeps it five minutes, so
     * the subtitles go first, on the run's fresh ticket, before a long video outlives it.
     */
    const sidecars = await sidecarsFor({ job, access })
    if (signal.aborted) return
    if (!(await fetchVideo({ job, access, hasRetried: false })) || signal.aborted) return
    await fs.rename({ from: partPathFor(partsOf(entry)), to: mediaPathFor(partsOf(entry)) })
    // The video is in place, so the file is ready whatever was asked of it meanwhile.
    store.update((state) =>
      finish({ state: setSidecars({ state, downloadId, sidecars }), downloadId }),
    )
    announceReady(downloadId)
  }

  const warnStopped = (error: unknown): void => {
    deps.warn(`Raven's downloads stopped short: ${loggable(errorText(error))}`)
  }

  const begin = (entry: DownloadEntry): void => {
    const { downloadId } = entry
    const settled = Promise.withResolvers<void>()
    const disk: RunDisk = { size: entry.size, bytes: bytesOf(entry), hasRoom: false }
    const run = runs.track({ downloadId, disk, done: settled.promise })
    const job: Job = {
      entry,
      signal: run.stop.signal,
      disk,
      onAccess: () => {
        run.hasAccess = true
      },
    }
    work(job)
      .catch((error: unknown) => {
        if (run.stop.signal.aborted) return
        failures.failEntry({
          entry,
          failure: { reason: FAIL_REASONS.other, message: errorText(error) },
        })
        deps.warn(`Raven could not download ${loggable(entry.label)}`)
      })
      .finally(() => {
        runs.drop(downloadId)
        settled.resolve()
        kick()
      })
      .catch(warnStopped)
  }

  const kick = (): void => {
    if (isDisposed || schedule.isAsleep()) return
    if (sweeping !== null) {
      sweeping.then(kick).catch(warnStopped)
      return
    }
    const slots = DOWNLOAD_CONCURRENCY - runs.count()
    if (slots <= 0) return
    const isIdle = (entry: DownloadEntry): boolean => !runs.isRunning(entry.downloadId)
    const { entries } = store.read()
    // A file left downloading by the last run goes first: it was under way.
    const resumed = entries.filter(
      (entry) => entry.status.kind === DOWNLOAD_STATUS_KINDS.downloading && isIdle(entry),
    )
    const queued = entries.filter(
      (entry) => entry.status.kind === DOWNLOAD_STATUS_KINDS.queued && isIdle(entry),
    )
    ;[...resumed, ...queued].slice(0, slots).forEach(begin)
  }

  const pauseOne: DownloadQueue['pause'] = async ({ downloadId }) => {
    runs.saveBytes(runOf(downloadId))
    store.update((state) => pause({ state, downloadId, reason: PAUSE_REASONS.viewer }))
    await runs.stop(runOf(downloadId))
    kick()
  }

  type ResumeEachProps = { downloadIds: readonly string[]; isRetry: boolean }

  const resumeEach = ({ downloadIds, isRetry }: ResumeEachProps): void => {
    downloadIds.forEach((downloadId) =>
      isRetry ? retried.add(downloadId) : retried.delete(downloadId),
    )
    store.update((state) =>
      downloadIds.reduce((next, downloadId) => resume({ state: next, downloadId }), state),
    )
    schedule.syncOutageRetry()
    kick()
  }

  type EntryPick = (entry: DownloadEntry) => boolean

  const idsOf = (isPicked: EntryPick): string[] =>
    store
      .read()
      .entries.filter(isPicked)
      .map(({ downloadId }) => downloadId)

  const retryOutages: DownloadQueue['retryOutages'] = () => {
    if (isDisposed) return
    resumeEach({ downloadIds: idsOf(isWaitingOnOutage), isRetry: true })
  }

  // One unlock lifts the lock for every file, so one Resume takes them all.
  const resumeOne: DownloadQueue['resume'] = ({ downloadId }) => {
    const entry = entryById({ state: store.read(), downloadId })
    if (entry === null) return
    const downloadIds = isRelocked(entry) ? idsOf(isRelocked) : [downloadId]
    resumeEach({ downloadIds, isRetry: false })
  }

  type RemovingProps = { path: string; what: string }

  const removing = ({ path, what }: RemovingProps): Promise<void> =>
    removeFolder({ fs, warn: deps.warn, path, what })

  const removeOne: DownloadQueue['remove'] = async ({ downloadId }) => {
    const entry = entryById({ state: store.read(), downloadId })
    if (entry === null) return
    store.update((state) => remove({ state, downloadId }))
    deps.onRemoved([entry])
    schedule.syncOutageRetry()
    await runs.stop(runOf(downloadId))
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
    schedule.syncOutageRetry()
    await runs.stop(EVERY_RUN)
    await removing({ path: downloadsDirFor({ userData }), what: 'its downloads' })
  }

  const accessEnded: DownloadQueue['accessEnded'] = () => {
    if (isDisposed) return
    accessEnds += 1
    const ended = runs.idsOf(({ downloadId, run }) => {
      const entry = entryById({ state: store.read(), downloadId })
      return run.hasAccess && entry !== null && isUnderWay(entry)
    })
    if (ended.length === 0) return
    failures.failSignedOut(ended)
    deps.warn(`Raven stopped downloading from ${SERVER_NAME}: its sign-in ended`)
  }

  return {
    kick,
    pause: pauseOne,
    resume: resumeOne,
    retry: ({ downloadId }) => resumeEach({ downloadIds: [downloadId], isRetry: false }),
    retryOutages,
    onSuspend: () => {
      if (isDisposed) return
      schedule.suspend()
      runs.saveBytes(EVERY_RUN)
      runs.stop(EVERY_RUN).catch(() => undefined)
    },
    onResume: () => {
      if (!isDisposed) schedule.wake()
    },
    pauseAll: async () => {
      runs.saveBytes(EVERY_RUN)
      store.update(pauseEverything)
      schedule.syncOutageRetry()
      await runs.stop(EVERY_RUN)
    },
    resumeAll: () =>
      resumeEach({
        downloadIds: idsOf((entry) => entry.status.kind === DOWNLOAD_STATUS_KINDS.paused),
        isRetry: false,
      }),
    remove: removeOne,
    removeAll: removeEverything,
    accessEnded,
    sweep: ({ wasSetAside }) => {
      const swept = sweepDownloads({ store, fs, userData, warn: deps.warn, wasSetAside }).finally(
        () => {
          sweeping = null
        },
      )
      sweeping = swept
      return swept
    },
    dispose: () => {
      runs.saveBytes(EVERY_RUN)
      isDisposed = true
      schedule.dispose()
      runs.abortAll()
    },
  }
}
