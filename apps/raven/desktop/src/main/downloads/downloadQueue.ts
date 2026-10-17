import { join } from 'node:path'
import {
  isMediaId,
  isMediaTracks,
  MEDIA_TICKET_REFRESH_SECONDS,
  type SubtitleTrack,
} from '@raven/core'
import type { ServerEntry } from '@/main/desktopConfig'
import { DOWNLOAD_MESSAGES } from '@/main/downloads/downloadMessages'
import {
  advance,
  entryById,
  fail,
  finish,
  pause,
  pauseServer,
  remove,
  removeAll,
  removeServer,
  resume,
  sameGroup,
  setSidecars,
  start,
  type DownloadEntry,
  type Sidecar,
} from '@/main/downloads/downloadState'
import type { DownloadsStore } from '@/main/downloads/downloadStore'
import { EXPAND_MESSAGES } from '@/main/downloads/expand'
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
import { errorText } from '@/main/log/errorText'
import { CALL_MESSAGES, loggable, type ServerCalls } from '@/main/servers/serverCalls'
import { sidecarTracksOf } from '@/main/servers/sidecarTracks'
import { isMissingFile, type Timers } from '@/main/stateStore'
import { isOpaqueId, SERVER_GONE } from '@/shared/protocol'

export const DOWNLOAD_CONCURRENCY = 2

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
}

export type DownloadQueue = {
  /** Starts queued files, and files a last run left downloading, up to `DOWNLOAD_CONCURRENCY`. */
  kick: () => void
  pause: (input: { downloadId: string }) => Promise<void>
  resume: (input: { downloadId: string }) => void
  retry: (input: { downloadId: string }) => void
  pauseAll: () => Promise<void>
  resumeAll: () => void
  /** Aborts the file, drops it and removes its folder. */
  remove: (input: { downloadId: string }) => Promise<void>
  /** Aborts the server's files, drops them, forgets its origin and removes `downloads/<serverId>`. */
  removeServer: (input: { serverId: string }) => Promise<void>
  /** Aborts every file, drops them all and removes the whole downloads folder. */
  removeAll: () => Promise<void>
  /** At launch: drops the files of servers no longer kept and removes the folders no file names. Never rejects. */
  sweep: () => Promise<void>
  /** Aborts every fetch; the entries stay as they are for the next launch. */
  dispose: () => void
}

/** Why a run's fetch was aborted: a renewed ticket fetches again, the rest leave the entry as the caller set it. */
const STOP_REASONS = ['refresh', 'pause', 'remove', 'dispose'] as const

type StopReason = (typeof STOP_REASONS)[number]

// An AbortError, so `fetchToFile` reads a stopped fetch as aborted rather than unreachable.
const stopping = (reason: StopReason): DOMException => new DOMException(reason, 'AbortError')

const stopReasonOf = (signal: AbortSignal): StopReason | null => {
  if (!signal.aborted) return null
  const reason: unknown = signal.reason
  if (!(reason instanceof DOMException)) return null
  return STOP_REASONS.find((known) => known === reason.message) ?? null
}

/** A file being fetched: `stop` aborts it, and `done` settles once it has let go of its files. */
type Run = { serverId: string; stop: AbortController; done: Promise<void> }

/** What one file's run needs at every step. */
type Job = { entry: DownloadEntry; server: ServerEntry; signal: AbortSignal }

type Failure = Extract<FetchOutcome, { ok: false }>

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** A folder name as a media id writes it, so `012` is never taken for `12`'s folder. */
const isMediaFolder = (name: string): boolean =>
  /^\d+$/u.test(name) && isMediaId(Number(name)) && String(Number(name)) === name

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

  const partsOf = (entry: DownloadEntry) => ({
    userData,
    serverId: entry.serverId,
    mediaId: entry.mediaId,
    container: entry.container,
  })

  const told = (downloadId: string): void => {
    const entry = entryById(store.read(), { downloadId })
    if (entry !== null && entry.status.kind === 'failed') deps.onFailed(entry)
  }

  const failEntry = ({ entry, message }: { entry: DownloadEntry; message: string }): void => {
    store.update((state) => fail(state, { downloadId: entry.downloadId, message }))
    told(entry.downloadId)
  }

  /** The disk is full: this file fails, and the files of its group still waiting wait paused. */
  const failForSpace = (entry: DownloadEntry): void => {
    const message = DOWNLOAD_MESSAGES.noSpace
    store.update((state) => {
      const failed = fail(state, { downloadId: entry.downloadId, message })
      return failed.entries
        .filter(
          (other) =>
            other.downloadId !== entry.downloadId &&
            other.status.kind === 'queued' &&
            sameGroup({ a: entry, b: other }),
        )
        .reduce((next, other) => pause(next, { downloadId: other.downloadId, message }), failed)
    })
    told(entry.downloadId)
  }

  const stopRuns = ({
    reason,
    isStopped,
  }: {
    reason: StopReason
    isStopped: (input: { downloadId: string; run: Run }) => boolean
  }): Promise<void> => {
    const stopped = [...running].filter(([downloadId, run]) => isStopped({ downloadId, run }))
    stopped.forEach(([, run]) => run.stop.abort(stopping(reason)))
    return Promise.all(stopped.map(([, run]) => run.done)).then(() => undefined)
  }

  /** Every other waiting or running file of the job's server waits paused with `message`. */
  const pauseServerOf = ({ job, message }: { job: Job; message: string }): void => {
    const { entry, server } = job
    store.update((state) => pauseServer(state, { serverId: server.id, message }))
    stopRuns({
      reason: 'pause',
      isStopped: ({ downloadId, run }) =>
        run.serverId === server.id && downloadId !== entry.downloadId,
    }).catch(() => undefined)
  }

  /** The server locked its library again: every file of it waits paused, running ones too. */
  const relock = (job: Job): void => {
    pauseServerOf({ job, message: DOWNLOAD_MESSAGES.relocked(job.server.name) })
    deps.warn(`${loggable(job.server.name)} locked ${loggable(job.entry.label)}'s library again`)
  }

  /**
   * The server could not be reached: this file fails, its part kept, and the rest of the
   * server's files wait paused, so an outage costs one failure rather than the whole queue.
   */
  const failUnreachable = ({ job, message }: { job: Job; message: string }): void => {
    failEntry({ entry: job.entry, message })
    pauseServerOf({ job, message: DOWNLOAD_MESSAGES.unreachable(job.server.name) })
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
        failUnreachable({ job, message: outcome.message })
        return null
      case 'unreadable':
        failEntry({ entry, message: outcome.message })
        return null
      default: {
        const unreachable: never = outcome.reason
        return unreachable
      }
    }
  }

  /** Aborts the fetch `MEDIA_TICKET_REFRESH_SECONDS` before its ticket lapses, so a new one is read (Ruling 7). */
  const renewalFor = ({
    access,
    refresh,
  }: {
    access: Access
    refresh: AbortController
  }): unknown => {
    if (access.kind !== 'origin') return undefined
    const ms = access.expiresAt - MEDIA_TICKET_REFRESH_SECONDS * 1000 - deps.now()
    return ms > 0 ? timers.set(() => refresh.abort(stopping('refresh')), ms) : undefined
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
    const { entry, server } = job
    // `bytes` is advisory, for the views, so it may be stored mid-stream: every resume reads
    // `part.size()` for its `Range` and corrects it.
    const onDisk = (bytes: number): void =>
      store.update((state) => advance(state, { downloadId: entry.downloadId, bytes }))
    const part = await fs.openPart(partPathFor(partsOf(entry)))
    return fetchToFile({
      fetch: deps.fetchFor({ serverId: entry.serverId, access }),
      url: fileUrlFor({ access, origin: server.origin, mediaId: entry.mediaId }),
      // A resumed row shows the bytes already on disk at once, not from the first progress step.
      part: {
        ...part,
        size: async () => {
          const bytes = await part.size()
          onDisk(bytes)
          return bytes
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
  const settleFailure = (job: Job, outcome: Failure): void => {
    const { entry, server } = job
    switch (outcome.reason) {
      case 'locked':
        relock(job)
        return
      case 'space':
        failForSpace(entry)
        return
      case 'changed':
        failEntry({ entry, message: DOWNLOAD_MESSAGES.changed })
        return
      case 'unreachable':
      case 'stalled':
      case 'aborted':
        // The origin picked may be the one that went away; the next file probes again.
        deps.access.forget(server.id)
        failUnreachable({ job, message: CALL_MESSAGES.unreachable(server.name) })
        return
      case 'unauthorized':
      case 'status': {
        const status = outcome.status ?? 0
        failEntry({
          entry,
          message:
            status === NOT_FOUND_STATUS
              ? EXPAND_MESSAGES.gone(server.name)
              : DOWNLOAD_MESSAGES.answered({ serverName: server.name, status }),
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
      settleFailure(job, outcome)
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
    const skipped = (): null => {
      if (!stop.aborted) {
        deps.warn(`raven player skipped subtitle ${track.id} of ${loggable(entry.label)}`)
      }
      return null
    }
    const late = new AbortController()
    const timer = timers.set(() => late.abort(), DOWNLOAD_STALL_MS)
    try {
      const response = await deps.fetchFor({ serverId: entry.serverId, access })({
        url: sidecarUrlFor({
          access,
          origin: server.origin,
          mediaId: entry.mediaId,
          trackId: track.id,
        }),
        headers: {},
        signal: AbortSignal.any([stop, late.signal]),
      })
      if (response.status !== 200) {
        if (response.body !== null) await response.body.cancel().catch(() => undefined)
        return skipped()
      }
      const text = await new Response(response.body).text()
      await fs.writeFile(sidecarPathFor({ ...partsOf(entry), trackId: track.id }), text)
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
  }: {
    downloadId: string
    signal: AbortSignal
  }): Promise<void> => {
    const entry = entryById(store.read(), { downloadId })
    if (entry === null) return
    const server = deps.serverOf(entry.serverId)
    if (server === null) {
      failEntry({ entry, message: SERVER_GONE })
      return
    }
    const job: Job = { entry, server, signal }
    const { free } = await readSpace({ fs: deps.space, dir: downloadsDirFor({ userData }) })
    // A resumed or retried file needs only what its part lacks, whatever its status says.
    const onDisk = await fs.size(partPathFor(partsOf(entry)))
    if (signal.aborted) return
    if (!fits({ bytes: entry.size - onDisk, free })) {
      failForSpace(entry)
      return
    }
    const access = await accessOf(job)
    if (access === null) return
    store.update((state) => start(state, { downloadId }))
    await fs.mkdir(entryDirFor(partsOf(entry)))
    if (signal.aborted) return
    const fetched = await fetchVideo({ job, access, hasRetried: false })
    if (fetched === null) return
    const sidecars = await sidecarsFor({ job, access: fetched })
    if (signal.aborted) return
    await fs.rename(partPathFor(partsOf(entry)), videoPathFor(partsOf(entry)))
    // The video is in place, so the file is ready whatever was asked of it meanwhile.
    store.update((state) => finish(setSidecars(state, { downloadId, sidecars }), { downloadId }))
    const ready = entryById(store.read(), { downloadId })
    if (ready !== null) deps.onFinished(ready)
  }

  const begin = (entry: DownloadEntry): void => {
    const { downloadId } = entry
    const stop = new AbortController()
    const settled = Promise.withResolvers<void>()
    running.set(downloadId, { serverId: entry.serverId, stop, done: settled.promise })
    work({ downloadId, signal: stop.signal })
      .catch((error: unknown) => {
        if (stop.signal.aborted) return
        failEntry({ entry, message: errorText(error) })
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
    if (isDisposed) return
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
    store.update((state) => pause(state, { downloadId, message: null }))
    await stopOne({ downloadId, reason: 'pause' })
    kick()
  }

  const requeue: DownloadQueue['resume'] = ({ downloadId }) => {
    store.update((state) => resume(state, { downloadId }))
    kick()
  }

  const pauseAll: DownloadQueue['pauseAll'] = async () => {
    store.update((state) =>
      state.entries.reduce(
        (next, entry) => pause(next, { downloadId: entry.downloadId, message: null }),
        state,
      ),
    )
    await stopRuns({ reason: 'pause', isStopped: () => true })
  }

  const resumeAll: DownloadQueue['resumeAll'] = () => {
    store.update((state) =>
      state.entries
        .filter((entry) => entry.status.kind === 'paused')
        .reduce((next, entry) => resume(next, { downloadId: entry.downloadId }), state),
    )
    kick()
  }

  /** Removes a folder; one that stays is swept at the next launch, so a failure is only logged. */
  const removeFolder = async ({ path, what }: { path: string; what: string }): Promise<void> => {
    await fs.rm(path).catch((error: unknown) => {
      deps.warn(`raven player could not remove ${what}: ${loggable(errorText(error))}`)
    })
  }

  const removeOne: DownloadQueue['remove'] = async ({ downloadId }) => {
    const entry = entryById(store.read(), { downloadId })
    if (entry === null) return
    store.update((state) => remove(state, { downloadId }))
    await stopOne({ downloadId, reason: 'remove' })
    await removeFolder({
      path: entryDirFor(partsOf(entry)),
      what: `the files of ${loggable(entry.label)}`,
    })
    kick()
  }

  const removeServerAll: DownloadQueue['removeServer'] = async ({ serverId }) => {
    if (!isOpaqueId(serverId)) return
    store.update((state) => removeServer(state, { serverId }))
    deps.access.forget(serverId)
    await stopRuns({ reason: 'remove', isStopped: ({ run }) => run.serverId === serverId })
    await removeFolder({
      path: serverDirFor({ userData, serverId }),
      what: "a removed server's downloads",
    })
    kick()
  }

  const removeEverything: DownloadQueue['removeAll'] = async () => {
    store.update(removeAll)
    await stopRuns({ reason: 'remove', isStopped: () => true })
    await removeFolder({ path: downloadsDirFor({ userData }), what: 'its downloads' })
  }

  /** The names in a folder; none when it does not exist, and none, with a warning, when it cannot be read. */
  const namesIn = (path: string): Promise<string[]> =>
    fs.readdir(path).catch((error: unknown) => {
      if (!isMissingFile(error)) {
        deps.warn(`raven player could not read its downloads: ${loggable(errorText(error))}`)
      }
      return []
    })

  const sweepFolders = async (): Promise<void> => {
    const kept = deps.servers().map(({ id }) => id)
    // An unreadable config loads empty and is set aside; its servers' downloads must outlive that.
    const canDropServers = kept.length > 0
    const isKept = (serverId: string): boolean => kept.includes(serverId)
    const dropped = canDropServers
      ? store.read().entries.filter((entry) => !isKept(entry.serverId))
      : []
    store.update((state) =>
      dropped.reduce((next, entry) => remove(next, { downloadId: entry.downloadId }), state),
    )
    if (dropped.length > 0) {
      deps.warn(`raven player dropped ${dropped.length} downloads of servers it no longer keeps`)
    }
    const root = downloadsDirFor({ userData })
    const servers = (await namesIn(root)).filter(isOpaqueId)
    const goneServers = canDropServers ? servers.filter((serverId) => !isKept(serverId)) : []
    // Read as each folder is listed, so a file queued meanwhile keeps its folder.
    const isNamed = ({ serverId, name }: { serverId: string; name: string }): boolean =>
      store
        .read()
        .entries.some((entry) => entry.serverId === serverId && String(entry.mediaId) === name)
    const unnamed = (
      await Promise.all(
        servers
          .filter(isKept)
          .map(async (serverId) =>
            (await namesIn(join(root, serverId)))
              .filter((name) => isMediaFolder(name) && !isNamed({ serverId, name }))
              .map((name) => join(root, serverId, name)),
          ),
      )
    ).flat()
    await Promise.all([
      ...goneServers.map((serverId) =>
        removeFolder({ path: join(root, serverId), what: "a removed server's downloads" }),
      ),
      ...unnamed.map((path) => removeFolder({ path, what: 'a download folder no download names' })),
    ])
    if (goneServers.length > 0) {
      deps.warn(
        `raven player removed the downloads of ${goneServers.length} servers it no longer keeps`,
      )
    }
    if (unnamed.length > 0) {
      deps.warn(`raven player removed ${unnamed.length} download folders no download names`)
    }
  }

  const dispose: DownloadQueue['dispose'] = () => {
    isDisposed = true
    running.forEach((run) => run.stop.abort(stopping('dispose')))
  }

  return {
    kick,
    pause: pauseOne,
    resume: requeue,
    retry: requeue,
    pauseAll,
    resumeAll,
    remove: removeOne,
    removeServer: removeServerAll,
    removeAll: removeEverything,
    sweep: () => {
      const sweeping = sweepFolders()
        .catch((error: unknown) => {
          deps.warn(`raven player could not sweep its downloads: ${loggable(errorText(error))}`)
        })
        .finally(() => {
          launch.sweeping = null
        })
      launch.sweeping = sweeping
      return sweeping
    },
    dispose,
  }
}
