import { isMediaTracks, type SubtitleTrack } from '@raven/core'
import type { ServerEntry } from '@/main/desktopConfig'
import { DOWNLOAD_MESSAGES } from '@/main/downloads/downloadMessages'
import {
  advance,
  bytesOf,
  entryById,
  fail,
  finish,
  isWaitingOnOutage,
  pause,
  pauseEverything,
  pauseServer,
  remove,
  removeAll,
  removeServer,
  resume,
  sameGroup,
  setSidecars,
  start,
  type DownloadEntry,
  type FailReason,
  type PauseReason,
  type Sidecar,
} from '@/main/downloads/downloadState'
import type { DownloadsStore } from '@/main/downloads/downloadStore'
import {
  DOWNLOAD_STALL_MS,
  fetchToFile,
  type FetchOutcome,
  type PartFile,
  type StreamFetch,
} from '@/main/downloads/fetchFile'
import {
  fileUrlFor,
  sidecarUrlFor,
  type Access,
  type MediaAccess,
} from '@/main/downloads/mediaAccess'
import {
  downloadsDirFor,
  entryDirFor,
  fits,
  partPathFor,
  readSpace,
  serverDirFor,
  sidecarPathFor,
  subtitlesDirFor,
  videoPathFor,
  type SpaceFs,
} from '@/main/downloads/space'
import { removeFolder, sweepDownloads } from '@/main/downloads/sweep'
import { errorText } from '@/main/log/errorText'
import { loggable, type ServerCalls } from '@/main/servers/serverCalls'
import { sidecarTracksOf } from '@/main/servers/sidecarTracks'
import type { Timers } from '@/main/stateStore'
import { isOpaqueId, SERVER_GONE } from '@/shared/protocol'

export const DOWNLOAD_CONCURRENCY = 2

/** The soonest a renewal comes, so a ticket already due is not read again at once. */
export const RENEWAL_MIN_MS = 60_000

/** Node runs a longer delay at once, so no timer is ever armed for more. */
const TIMER_MAX_MS = 2 ** 31 - 1

/** How often the files waiting on an outage are tried again, while any waits. */
export const OUTAGE_RETRY_MS = 300_000

/** How long a wake from sleep is given for the network to come back before files start again. */
export const RESUME_SETTLE_MS = 5000

/** The most of a subtitle kept; a larger one is skipped rather than read whole into memory. */
export const SIDECAR_MAX_BYTES = 16 * 1024 ** 2

const NOT_FOUND_STATUS = 404

/** The parts of `node:fs/promises` the queue uses; main passes a recursive `mkdir` and a forced, recursive `rm`. */
export type QueueFs = {
  mkdir: (path: string) => Promise<void>
  rename: (from: string, to: string) => Promise<void>
  rm: (path: string) => Promise<void>
  readdir: (path: string) => Promise<string[]>
  openPart: (path: string) => Promise<PartFile>
  writeFile: (path: string, text: string) => Promise<void>
  /** A file's size, 0 when there is no such file. */
  size: (path: string) => Promise<number>
}

export type DownloadQueueDeps = {
  store: DownloadsStore
  serverOf: (serverId: string) => ServerEntry | null
  /** Every server raven player keeps, as the config holds them now. */
  servers: () => readonly ServerEntry[]
  access: MediaAccess
  /** The session's fetch, cookies along, for the cookie kind; a bare fetch with no cookie for an origin. Both `redirect: 'error'`. */
  fetchFor: (input: { serverId: string; access: Access }) => StreamFetch
  calls: Pick<ServerCalls, 'call'>
  fs: QueueFs
  space: SpaceFs
  userData: string
  timers: Timers
  now: () => number
  warn: (message: string) => void
  onFinished: (entry: DownloadEntry) => void
  onFailed: (entry: DownloadEntry) => void
  /** The downloads `remove`, `removeServer`, `removeAll` and the sweep dropped. */
  onRemoved: (entries: readonly DownloadEntry[]) => void
}

export type DownloadQueue = {
  /** Starts queued files, and files a last run left downloading, up to `DOWNLOAD_CONCURRENCY`. */
  kick: () => void
  pause: (input: { downloadId: string }) => Promise<void>
  /** Requeues the file; a file paused by a relock requeues every file its server's relock paused. */
  resume: (input: { downloadId: string }) => void
  retry: (input: { downloadId: string }) => void
  /** Requeues every file waiting on an outage and starts what can start: at launch, after the sweep. */
  retryOutages: () => void
  /** The computer is going to sleep: every fetch stops, its file left downloading, and none starts. */
  onSuspend: () => void
  /** The computer woke: files start again once `RESUME_SETTLE_MS` has passed. */
  onResume: () => void
  pauseAll: () => Promise<void>
  resumeAll: () => void
  /** Aborts the file, drops it and removes its folder. */
  remove: (input: { downloadId: string }) => Promise<void>
  /** Aborts the server's files, drops them, forgets its origin and removes `downloads/<serverId>`. */
  removeServer: (input: { serverId: string }) => Promise<void>
  /** Aborts every file, drops them all and removes the whole downloads folder. */
  removeAll: () => Promise<void>
  /** At launch: `sweepDownloads`, holding any kick until it is done. Never rejects. */
  sweep: (input: { wasSetAside: boolean }) => Promise<void>
  /** Aborts every fetch; the entries stay as they are for the next launch. */
  dispose: () => void
}

/** Why a run's fetch was aborted: a renewed ticket fetches again, the rest leave the entry as the caller set it. */
const STOP_REASONS = ['refresh', 'pause', 'remove', 'suspend', 'dispose'] as const

type StopReason = (typeof STOP_REASONS)[number]

// An AbortError, so `fetchToFile` reads a stopped fetch as aborted rather than unreachable.
const stopping = (reason: StopReason): DOMException => new DOMException(reason, 'AbortError')

const stopReasonOf = (signal: AbortSignal): StopReason | null => {
  if (!signal.aborted) return null
  const reason: unknown = signal.reason
  if (!(reason instanceof DOMException)) return null
  return STOP_REASONS.find((known) => known === reason.message) ?? null
}

/** A body's text, read only up to `max` bytes: past them, the rest is never read. */
const textUpTo = async ({
  body,
  max,
  signal,
}: {
  body: ReadableStream<Uint8Array> | null
  max: number
  signal: AbortSignal
}): Promise<{ kind: 'text'; text: string } | { kind: 'tooBig' }> => {
  const decoder = new TextDecoder()
  const read: { bytes: number; text: string; isOver: boolean } = {
    bytes: 0,
    text: '',
    isOver: false,
  }
  const sink = new WritableStream<Uint8Array>({
    write: (chunk) => {
      read.bytes += chunk.length
      if (read.bytes > max) {
        read.isOver = true
        throw new RangeError('The subtitle is larger than raven player keeps')
      }
      read.text += decoder.decode(chunk, { stream: true })
    },
  })
  try {
    await (body ?? new ReadableStream<Uint8Array>({ start: (c) => c.close() })).pipeTo(sink, {
      signal,
    })
  } catch (error) {
    if (read.isOver) return { kind: 'tooBig' }
    throw error
  }
  return { kind: 'text', text: read.text + decoder.decode() }
}

const isRelocked = ({ status }: DownloadEntry): boolean =>
  status.kind === 'paused' && status.reason === 'relocked'

/** A file being fetched: `stop` aborts it, and `done` settles once it has let go of its files. */
type Run = { serverId: string; stop: AbortController; done: Promise<void>; disk: RunDisk }

/**
 * What a run's part holds, counted as it is written, and whether its space check has passed:
 * from then on, what it still lacks is room another file may not take.
 */
type RunDisk = { size: number; bytes: number; hasRoom: boolean }

/** What one file's run needs at every step. */
type Job = { entry: DownloadEntry; server: ServerEntry; signal: AbortSignal; disk: RunDisk }

const lackedBy = ({ disk }: Run): number => (disk.hasRoom ? Math.max(disk.size - disk.bytes, 0) : 0)

type Failure = Extract<FetchOutcome, { ok: false }>

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** Settles with null as soon as `signal` aborts, so a stopped run never waits on a slow server. */
const unlessStopped = <T>({
  task,
  signal,
}: {
  task: Promise<T>
  signal: AbortSignal
}): Promise<T | null> => {
  if (signal.aborted) return Promise.resolve(null)
  const stopped = Promise.withResolvers<null>()
  const onAbort = (): void => stopped.resolve(null)
  signal.addEventListener('abort', onAbort, { once: true })
  return Promise.race([task, stopped.promise]).finally(() =>
    signal.removeEventListener('abort', onAbort),
  )
}

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
    if (entry === null || entry.status.kind !== 'failed') return
    // The outage was told when it began, and the row still says so.
    if (isRetried && entry.status.reason === 'unreachable') return
    deps.onFailed(entry)
  }

  const failEntry = ({
    entry,
    reason,
    message,
  }: {
    entry: DownloadEntry
    reason: FailReason
    message?: string
  }): void => {
    store.update((state) => fail(state, { downloadId: entry.downloadId, reason, message }))
    told(entry.downloadId)
  }

  type RunPick = (input: { downloadId: string; run: Run }) => boolean

  const stopRuns = ({
    reason,
    isStopped,
  }: {
    reason: StopReason
    isStopped: RunPick
  }): Promise<void> => {
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
          other.status.kind === 'queued' &&
          sameGroup({ a: entry, b: other }),
      )
      .map(({ downloadId }) => downloadId)
    store.update((state) =>
      waiting.reduce(
        (next, downloadId) => pause(next, { downloadId, reason: 'noSpace' }),
        fail(state, { downloadId: entry.downloadId, reason: 'noSpace' }),
      ),
    )
    stopRuns({
      reason: 'pause',
      isStopped: ({ downloadId }) => waiting.includes(downloadId),
    }).catch(() => undefined)
    told(entry.downloadId)
  }

  /** Every other waiting or running file of the job's server waits paused for `reason`. */
  const pauseServerOf = ({ job, reason }: { job: Job; reason: PauseReason }): void => {
    const { entry, server } = job
    saveBytes(({ run }) => run.serverId === server.id)
    store.update((state) => pauseServer(state, { serverId: server.id, reason }))
    stopRuns({
      reason: 'pause',
      isStopped: ({ downloadId, run }) =>
        run.serverId === server.id && downloadId !== entry.downloadId,
    }).catch(() => undefined)
  }

  /** The server locked its library again: every file of it waits paused, running ones too. */
  const relock = (job: Job): void => {
    pauseServerOf({ job, reason: 'relocked' })
    deps.warn(`${loggable(job.server.name)} locked ${loggable(job.entry.label)}'s library again`)
  }

  /**
   * The server could not be reached: this file fails, its part kept, and the rest of the
   * server's files wait paused, so an outage costs one failure rather than the whole queue.
   */
  const failUnreachable = (job: Job): void => {
    failEntry({ entry: job.entry, reason: 'unreachable' })
    pauseServerOf({ job, reason: 'unreachable' })
    syncOutageRetry()
    deps.warn(
      `raven player could not reach ${loggable(job.server.name)} for ${loggable(job.entry.label)}`,
    )
  }

  /** A new access, or null once the file has been failed or paused for why there is none. */
  const accessOf = async (job: Job): Promise<Access | null> => {
    const { entry, signal } = job
    const outcome = await unlessStopped({
      task: deps.access.accessFor({ serverId: entry.serverId, mediaId: entry.mediaId }),
      signal,
    })
    if (outcome === null || signal.aborted) return null
    if (outcome.ok) return outcome.access
    switch (outcome.reason) {
      case 'locked':
        relock(job)
        return null
      case 'unreachable':
        failUnreachable(job)
        return null
      case 'unreadable':
        failEntry({ entry, reason: 'other', message: outcome.message })
        return null
      case 'gone':
        failEntry({ entry, reason: 'gone' })
        return null
      default: {
        const unreachable: never = outcome.reason
        return unreachable
      }
    }
  }

  /** Aborts the fetch when its ticket is due for renewal, so a new one is read (Ruling 7). */
  const renewalFor = ({
    access,
    refresh,
  }: {
    access: Access
    refresh: AbortController
  }): unknown => {
    if (access.kind !== 'origin') return undefined
    const ms = access.renewAt - deps.now()
    const delay = Math.min(Math.max(ms, RENEWAL_MIN_MS), TIMER_MAX_MS)
    return timers.set(() => refresh.abort(stopping('refresh')), delay)
  }

  const fetchOnce = async ({
    job,
    access,
    signal,
  }: {
    job: Job
    access: Access
    signal: AbortSignal
  }): Promise<FetchOutcome> => {
    const { entry, server, disk } = job
    // `bytes` is advisory, for the views, so it may be stored mid-stream: every resume reads
    // `part.size()` for its `Range` and corrects it.
    const onDisk = (bytes: number): void =>
      store.update((state) => advance(state, { downloadId: entry.downloadId, bytes }))
    const part = await fs.openPart(partPathFor(partsOf(entry)))
    return fetchToFile({
      fetch: deps.fetchFor({ serverId: entry.serverId, access }),
      url: fileUrlFor({ access, origin: server.origin, mediaId: entry.mediaId }),
      // The run counts every byte as it lands; a resumed row shows the bytes already on disk at
      // once, not from the first progress step.
      part: {
        ...part,
        size: async () => {
          const bytes = await part.size()
          disk.bytes = bytes
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
  }

  /** Fails or pauses the file for why its fetch stopped short. */
  const settleFailure = ({ job, outcome }: { job: Job; outcome: Failure }): void => {
    const { entry, server } = job
    switch (outcome.reason) {
      case 'locked':
        relock(job)
        return
      case 'space':
        failForSpace(entry)
        return
      case 'changed':
        failEntry({ entry, reason: 'changed' })
        return
      case 'unreachable':
      case 'stalled':
      case 'aborted':
        // The origin picked may be the one that went away; the next file probes again.
        deps.access.forget(server.id)
        failUnreachable(job)
        return
      case 'unauthorized':
        failEntry({ entry, reason: 'unauthorized' })
        return
      case 'status': {
        const status = outcome.status ?? 0
        // A proxy in front of a restarting server answers 502 to 504: an outage, not a refusal.
        if (status >= 500) {
          deps.access.forget(server.id)
          failUnreachable(job)
          return
        }
        if (status === NOT_FOUND_STATUS) {
          failEntry({ entry, reason: 'gone' })
          return
        }
        failEntry({
          entry,
          reason: 'other',
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

  /**
   * Fetches the video into its `.part` and answers the access it ended with, or null once the
   * file has been failed, paused or stopped. A ticket about to lapse is renewed, and a 401 or
   * 423 reads a new access once per ticket before it counts.
   */
  const fetchVideo = async ({
    job,
    access,
    hasRetried,
  }: {
    job: Job
    access: Access
    hasRetried: boolean
  }): Promise<Access | null> => {
    const { entry, signal: stop } = job
    const refresh = new AbortController()
    const signal = AbortSignal.any([stop, refresh.signal])
    const renewal = renewalFor({ access, refresh })
    const outcome = await fetchOnce({ job, access, signal }).finally(() => timers.clear(renewal))
    if (stop.aborted) return null
    if (outcome.ok) return access
    // The part is closed now, so the bytes it holds can be kept.
    store.update((state) => advance(state, { downloadId: entry.downloadId, bytes: outcome.bytes }))
    const isRenewal = stopReasonOf(signal) === 'refresh'
    const isRefused = outcome.reason === 'unauthorized' || outcome.reason === 'locked'
    if (!isRenewal && !(isRefused && !hasRetried)) {
      settleFailure({ job, outcome })
      return null
    }
    const next = await accessOf(job)
    if (next === null) return null
    // A renewed ticket gets its own re-read, so a long file can meet a server restart in each ticket's life.
    return fetchVideo({ job, access: next, hasRetried: !isRenewal })
  }

  const tracksOf = async ({ entry, signal }: Job): Promise<SubtitleTrack[]> => {
    const reply = await unlessStopped({
      task: deps.calls
        .call({ serverId: entry.serverId, call: { name: 'getTracks', mediaId: entry.mediaId } })
        .catch(() => null),
      signal,
    })
    const body = reply !== null && reply.ok && reply.status === 200 ? parseJson(reply.body) : null
    if (isMediaTracks(body)) return sidecarTracksOf(body)
    if (!signal.aborted) {
      deps.warn(`raven player kept no subtitles for ${loggable(entry.label)}: no track list`)
    }
    return []
  }

  /** Fetches one subtitle whole and writes it; a failure is logged by title and track and skipped. */
  const fetchSidecar = async ({
    job,
    access,
    track,
  }: {
    job: Job
    access: Access
    track: SubtitleTrack
  }): Promise<Sidecar | null> => {
    const { entry, server, signal: stop } = job
    const skipped = (why = ''): null => {
      if (!stop.aborted) {
        deps.warn(`raven player skipped subtitle ${track.id} of ${loggable(entry.label)}${why}`)
      }
      return null
    }
    const late = new AbortController()
    const timer = timers.set(() => late.abort(), DOWNLOAD_STALL_MS)
    const signal = AbortSignal.any([stop, late.signal])
    try {
      const response = await deps.fetchFor({ serverId: entry.serverId, access })({
        url: sidecarUrlFor({
          access,
          origin: server.origin,
          mediaId: entry.mediaId,
          trackId: track.id,
        }),
        headers: {},
        signal,
      })
      if (response.status !== 200) {
        if (response.body !== null) await response.body.cancel().catch(() => undefined)
        return skipped()
      }
      const read = await textUpTo({ body: response.body, max: SIDECAR_MAX_BYTES, signal })
      if (read.kind === 'tooBig') return skipped(': it is larger than 16 MiB')
      await fs.writeFile(sidecarPathFor({ ...partsOf(entry), trackId: track.id }), read.text)
      return { trackId: track.id, title: track.title ?? '', language: track.language ?? '' }
    } catch {
      return skipped()
    } finally {
      timers.clear(timer)
    }
  }

  const sidecarsFor = async ({ job, access }: { job: Job; access: Access }): Promise<Sidecar[]> => {
    const tracks = await tracksOf(job)
    if (tracks.length === 0 || job.signal.aborted) return []
    const isMade = await fs.mkdir(subtitlesDirFor(partsOf(job.entry))).then(
      () => true,
      () => false,
    )
    if (!isMade) {
      deps.warn(
        `raven player kept no subtitles for ${loggable(job.entry.label)}: no folder for them`,
      )
      return []
    }
    const written = await Promise.all(tracks.map((track) => fetchSidecar({ job, access, track })))
    return written.flatMap((sidecar) => (sidecar === null ? [] : [sidecar]))
  }

  /** One file, from the space check to `ready`. */
  const work = async ({
    downloadId,
    signal,
    disk,
  }: {
    downloadId: string
    signal: AbortSignal
    disk: RunDisk
  }): Promise<void> => {
    const entry = entryById(store.read(), { downloadId })
    if (entry === null) return
    const server = deps.serverOf(entry.serverId)
    if (server === null) {
      failEntry({ entry, reason: 'other', message: SERVER_GONE })
      return
    }
    const job: Job = { entry, server, signal, disk }
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
    if ((entryById(store.read(), { downloadId })?.status.kind ?? null) !== 'downloading') return
    await fs.mkdir(entryDirFor(partsOf(entry)))
    if (signal.aborted) return
    const fetched = await fetchVideo({ job, access, hasRetried: false })
    if (fetched === null) return
    const sidecars = await sidecarsFor({ job, access: fetched })
    if (signal.aborted) return
    await fs.rename(partPathFor(partsOf(entry)), videoPathFor(partsOf(entry)))
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
    running.set(downloadId, { serverId: entry.serverId, stop, done: settled.promise, disk })
    work({ downloadId, signal: stop.signal, disk })
      .catch((error: unknown) => {
        if (stop.signal.aborted) return
        failEntry({ entry, reason: 'other', message: errorText(error) })
        deps.warn(`raven player could not download ${loggable(entry.label)}`)
      })
      .finally(() => {
        running.delete(downloadId)
        settled.resolve()
        kick()
      })
      .catch((error: unknown) => {
        deps.warn(`raven player's downloads stopped short: ${loggable(errorText(error))}`)
      })
  }

  const kick = (): void => {
    if (isDisposed || sleep.isAsleep) return
    if (launch.sweeping !== null) {
      launch.sweeping.then(kick).catch((error: unknown) => {
        deps.warn(`raven player's downloads stopped short: ${loggable(errorText(error))}`)
      })
      return
    }
    const slots = DOWNLOAD_CONCURRENCY - running.size
    if (slots <= 0) return
    const isIdle = (entry: DownloadEntry): boolean => !running.has(entry.downloadId)
    const { entries } = store.read()
    // A file left downloading by the last run goes first: it was under way.
    const resumed = entries.filter((entry) => entry.status.kind === 'downloading' && isIdle(entry))
    const queued = entries.filter((entry) => entry.status.kind === 'queued' && isIdle(entry))
    const next = [...resumed, ...queued].slice(0, slots)
    next.forEach(begin)
  }

  const stopOne = ({ downloadId, reason }: { downloadId: string; reason: StopReason }) =>
    stopRuns({ reason, isStopped: (candidate) => candidate.downloadId === downloadId })

  const pauseOne: DownloadQueue['pause'] = async ({ downloadId }) => {
    saveBytes((candidate) => candidate.downloadId === downloadId)
    store.update((state) => pause(state, { downloadId, reason: 'viewer' }))
    await stopOne({ downloadId, reason: 'pause' })
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
    outage.retry = timers.set(() => {
      outage.retry = undefined
      retryOutages()
    }, OUTAGE_RETRY_MS)
  }

  const resumeEach = ({
    downloadIds,
    isRetry,
  }: {
    downloadIds: readonly string[]
    isRetry: boolean
  }): void => {
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
    await stopRuns({ reason: 'pause', isStopped: () => true })
  }

  const resumeAll: DownloadQueue['resumeAll'] = () => {
    resumeEach({
      downloadIds: store
        .read()
        .entries.filter((entry) => entry.status.kind === 'paused')
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
    stopRuns({ reason: 'suspend', isStopped: () => true }).catch(() => undefined)
  }

  const onResume: DownloadQueue['onResume'] = () => {
    if (isDisposed) return
    timers.clear(sleep.settle)
    sleep.settle = timers.set(() => {
      sleep.settle = undefined
      sleep.isAsleep = false
      // A wake may come on another network, so each server's origin is picked again.
      deps.servers().forEach(({ id }) => deps.access.forget(id))
      retryOutages()
    }, RESUME_SETTLE_MS)
  }

  const removing = ({ path, what }: { path: string; what: string }): Promise<void> =>
    removeFolder({ fs, warn: deps.warn, path, what })

  const removeOne: DownloadQueue['remove'] = async ({ downloadId }) => {
    const entry = entryById(store.read(), { downloadId })
    if (entry === null) return
    store.update((state) => remove(state, { downloadId }))
    deps.onRemoved([entry])
    syncOutageRetry()
    await stopOne({ downloadId, reason: 'remove' })
    await removing({
      path: entryDirFor(partsOf(entry)),
      what: `the files of ${loggable(entry.label)}`,
    })
    kick()
  }

  const removeServerAll: DownloadQueue['removeServer'] = async ({ serverId }) => {
    if (!isOpaqueId(serverId)) return
    const dropped = store.read().entries.filter((entry) => entry.serverId === serverId)
    store.update((state) => removeServer(state, { serverId }))
    if (dropped.length > 0) deps.onRemoved(dropped)
    syncOutageRetry()
    deps.access.forget(serverId)
    await stopRuns({ reason: 'remove', isStopped: ({ run }) => run.serverId === serverId })
    await removing({
      path: serverDirFor({ userData, serverId }),
      what: "a removed server's downloads",
    })
    kick()
  }

  const removeEverything: DownloadQueue['removeAll'] = async () => {
    const dropped = store.read().entries
    store.update(removeAll)
    if (dropped.length > 0) deps.onRemoved(dropped)
    syncOutageRetry()
    await stopRuns({ reason: 'remove', isStopped: () => true })
    await removing({ path: downloadsDirFor({ userData }), what: 'its downloads' })
  }

  const dispose: DownloadQueue['dispose'] = () => {
    saveBytes(() => true)
    isDisposed = true
    clearOutageRetry()
    timers.clear(sleep.settle)
    sleep.settle = undefined
    running.forEach((run) => run.stop.abort(stopping('dispose')))
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
    removeServer: removeServerAll,
    removeAll: removeEverything,
    sweep: ({ wasSetAside }) => {
      const sweeping = sweepDownloads({
        store,
        fs,
        servers: deps.servers,
        userData,
        warn: deps.warn,
        onRemoved: deps.onRemoved,
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
