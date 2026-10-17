import { relative, sep } from 'node:path'
import type { ConfigStore } from '@/main/desktopConfig'
import { createDownloadAsks, type DownloadAsks } from '@/main/downloads/asks'
import { DOWNLOAD_MESSAGES, failedMessage, pausedMessage } from '@/main/downloads/downloadMessages'
import {
  createDownloadQueue,
  type DownloadQueueDeps,
  type QueueFs,
} from '@/main/downloads/downloadQueue'
import {
  bytesOf,
  entryById,
  notePending,
  noteWatched,
  sameGroup,
  setAutoDelete,
  setAutoDeleteDefault,
  sortDownloads,
  type DownloadEntry,
  type EntryStatus,
  type DownloadsState,
} from '@/main/downloads/downloadState'
import type { DownloadsStore } from '@/main/downloads/downloadStore'
import type { MediaAccess } from '@/main/downloads/mediaAccess'
import {
  downloadsDirFor,
  readSpace,
  sidecarPathFor,
  type SpaceFs,
  videoPathFor,
} from '@/main/downloads/space'
import type { Grants } from '@/main/grants'
import { errorText } from '@/main/log/errorText'
import type { LocalSidecar } from '@/main/player/playerService'
import {
  type FileFacts,
  forgetResume,
  type PlayerState,
  removeRecent,
  watchedShare,
} from '@/main/playerState'
import { loggable, type ServerCalls } from '@/main/servers/serverCalls'
import { serverById } from '@/main/servers/serverList'
import type { StateStore, Timers } from '@/main/stateStore'
import {
  type DesktopEvent,
  type DesktopReply,
  type DownloadStatus,
  type DownloadView,
  isOpaqueId,
  MAX_QUEUE,
} from '@/shared/protocol'

/** The `downloads` event goes out at most once in this long, so progress cannot flood the page. */
export const DOWNLOADS_EVENT_MS = 250

export type DownloadServiceDeps = {
  store: DownloadsStore
  config: ConfigStore
  calls: Pick<ServerCalls, 'call'>
  userData: string
  space: SpaceFs
  timers: Timers
  now: () => number
  newId: () => string
  send: (event: DesktopEvent) => void
  warn: (message: string) => void
  access: MediaAccess
  fetchFor: DownloadQueueDeps['fetchFor']
  fs: QueueFs
  showItemInFolder: (path: string) => void
  /** Settles once the network can be used (main's `app.whenReady()`); the launch's first kick waits on it. */
  ready: Promise<void>
  /** `downloads.json` could not be read and was set aside, so the launch sweep keeps every folder. */
  wasSetAside: boolean
  /** A download plays as any local file does, through a grant. */
  grants: Grants
  /** The player's state, which holds a download's recent, resume spot and share watched. */
  state: StateStore
  stat: (path: string) => Promise<{ size: number; mtimeMs: number }>
}

type ById = { downloadId: string }

export type DownloadService = Pick<DownloadAsks, 'ask' | 'retryAsk' | 'confirm' | 'decline'> & {
  list: () => DesktopReply
  readSpace: () => Promise<DesktopReply>
  setDefaults: (input: { autoDelete: boolean }) => DesktopReply
  views: () => DownloadView[]
  pause: (input: ById) => Promise<DesktopReply>
  resume: (input: ById) => DesktopReply
  retry: (input: ById) => DesktopReply
  remove: (input: ById) => Promise<DesktopReply>
  setAutoDelete: (input: ById & { autoDelete: boolean }) => DesktopReply
  pauseAll: () => Promise<DesktopReply>
  resumeAll: () => DesktopReply
  removeAll: () => Promise<DesktopReply>
  /** Called when a server is removed from raven player (Ruling 17). */
  removeServer: (input: { serverId: string }) => Promise<void>
  showFolder: () => Promise<DesktopReply>
  /** Plays a ready download as a local file, with its group's later ready files queued. */
  open: (input: ById) => Promise<DesktopReply>
  /** The subtitle files kept beside a granted download's video; none for any other file. */
  sidecarsOf: (fileId: string) => readonly LocalSidecar[]
  /** "Downloaded from <server>" for a path in the downloads folder, else null. */
  fromLabelOf: (input: { path: string }) => string | null
  /** The title of the download whose video is at `path`, else null. */
  labelOf: (input: { path: string }) => string | null
  /** The page opened a granted file: the next position noted for a download's video is a play. */
  noteOpened: (input: { fileId: string }) => void
  /** A position saved for a granted file; for a download's video, what the server will hear. */
  notePosition: (input: { fileId: string; position: number; duration: number | null }) => void
  /** What the player loaded: a granted file, or nothing of this computer's (a server title, Home). */
  notePlaying: (input: { fileId: string | null }) => void
  /** Main's `powerMonitor` `suspend`: every fetch stops and its file waits for the wake. */
  onSuspend: () => void
  /** Main's `powerMonitor` `resume`: files start again once the network has had a moment. */
  onResume: () => void
  /** Stops the events and every fetch; after it the page hears nothing more. */
  dispose: () => void
}

/** The list as both the `downloads` reply and the `downloads` event carry it. */
type DownloadsList = Extract<DesktopEvent, { type: 'downloads' }>

const refused = (message: string): DesktopReply => ({ type: 'refused', message })

/** A stored status as the page reads it: its reason in words, named by the server's name now. */
export const viewStatusOf = ({
  status,
  serverName,
}: {
  status: EntryStatus
  serverName: string
}): DownloadStatus => {
  switch (status.kind) {
    case 'queued':
    case 'downloading':
    case 'ready':
      return status
    case 'paused':
      return {
        kind: 'paused',
        bytes: status.bytes,
        message: pausedMessage({ reason: status.reason, serverName }),
      }
    case 'failed':
      return {
        kind: 'failed',
        bytes: status.bytes,
        message: failedMessage({ reason: status.reason, message: status.message, serverName }),
      }
    default: {
      const unreachable: never = status
      return unreachable
    }
  }
}

/** Drops these videos' recents and resume spots; the same state when it names none of them. */
const forgetVideos = (state: PlayerState, { paths }: { paths: readonly string[] }): PlayerState => {
  const isNamed = (path: string): boolean =>
    state.recents.some((recent) => recent.kind === 'file' && recent.path === path) ||
    state.resume.some((spot) => spot.path === path)
  return paths
    .filter(isNamed)
    .reduce(
      (next, path) => forgetResume({ state: removeRecent({ state: next, path }), path }),
      state,
    )
}

export const createDownloadService = (deps: DownloadServiceDeps): DownloadService => {
  const { store, config } = deps
  const announcing: { timer: unknown } = { timer: undefined }
  let isDisposed = false
  /** Each ready download's video as last read, so `views` reads its share watched at once. */
  const factsById = new Map<string, FileFacts>()
  /** The download each granted video belongs to, learnt as the files are opened. */
  const downloadIdByFile = new Map<string, string>()
  /** Videos opened and not played yet: the first position noted for one is its play. */
  const freshFiles = new Set<string>()
  /** The download the player loaded, so a deletion can wait until the player leaves it. */
  const playing: { downloadId: string | null } = { downloadId: null }

  const serverNameOf = (serverId: string): string =>
    serverById({ config: config.read(), serverId })?.name ?? ''

  const videoPathOf = ({ serverId, mediaId, container }: DownloadEntry): string =>
    videoPathFor({ userData: deps.userData, serverId, mediaId, container })

  const entryAt = (path: string): DownloadEntry | null =>
    store.read().entries.find((entry) => videoPathOf(entry) === path) ?? null

  /** The download a granted file is the video of; one granted outside `open` is found by its path. */
  const entryOfFile = (fileId: string): DownloadEntry | null => {
    const known = downloadIdByFile.get(fileId)
    if (known !== undefined) return entryById(store.read(), { downloadId: known })
    const file = deps.grants.fileOf(fileId)
    const entry = file === null ? null : entryAt(file.path)
    if (entry !== null) downloadIdByFile.set(fileId, entry.downloadId)
    return entry
  }

  const watchedOf = (downloadId: string): number | null => {
    const file = factsById.get(downloadId)
    return file === undefined ? null : watchedShare({ state: deps.state.read(), file })
  }

  const views = (): DownloadView[] =>
    sortDownloads(store.read().entries).map((entry) => {
      const serverName = serverNameOf(entry.serverId)
      return {
        downloadId: entry.downloadId,
        serverId: entry.serverId,
        label: entry.label,
        group: entry.group,
        serverName,
        size: entry.size,
        status: viewStatusOf({ status: entry.status, serverName }),
        autoDelete: entry.autoDelete,
        watched: watchedOf(entry.downloadId),
        deletesAt: null,
        needsUnlock: entry.status.kind === 'paused' && entry.status.reason === 'relocked',
      }
    })

  const list = (): DownloadsList => ({
    type: 'downloads',
    downloads: views(),
    autoDeleteDefault: store.read().autoDeleteDefault,
  })

  // The list is read when the timer fires, so every change folded into it is in it.
  const announce = (): void => {
    if (isDisposed || announcing.timer !== undefined) return
    announcing.timer = deps.timers.set({
      run: () => {
        announcing.timer = undefined
        deps.send(list())
      },
      ms: DOWNLOADS_EVENT_MS,
    })
  }

  /** Every change to the state goes through here, so the page hears each one. */
  const change = (apply: (state: DownloadsState) => DownloadsState): void => {
    const before = store.read()
    store.update(apply)
    if (store.read() !== before) announce()
  }

  const notice = (message: string): void => {
    if (!isDisposed) deps.send({ type: 'notice', message })
  }

  /** Reads a ready download's file for its share watched; a file that cannot be read shows none. */
  const learnFacts = async (entry: DownloadEntry): Promise<boolean> => {
    const path = videoPathOf(entry)
    const facts = await deps.stat(path).then(
      ({ size, mtimeMs }): FileFacts | null => ({ path, size, mtimeMs }),
      () => null,
    )
    // A download removed while its file was read keeps nothing.
    if (facts === null || entryById(store.read(), { downloadId: entry.downloadId }) === null) {
      return false
    }
    factsById.set(entry.downloadId, facts)
    return true
  }

  const learnAndTell = async (entries: readonly DownloadEntry[]): Promise<void> => {
    const learnt = await Promise.all(entries.map(learnFacts))
    if (learnt.includes(true)) announce()
  }

  const warnFacts = (error: unknown): void => {
    deps.warn(`raven player could not read its downloaded files: ${loggable(errorText(error))}`)
  }

  /** Whatever names a removed download goes with it: its recent, its resume spot, its grants. */
  const forget = (entries: readonly DownloadEntry[]): void => {
    const removed = new Set(entries.map(({ downloadId }) => downloadId))
    deps.state.update((state) => forgetVideos(state, { paths: entries.map(videoPathOf) }))
    removed.forEach((downloadId) => factsById.delete(downloadId))
    const files = [...downloadIdByFile].filter(([, downloadId]) => removed.has(downloadId))
    files.forEach(([fileId]) => {
      downloadIdByFile.delete(fileId)
      freshFiles.delete(fileId)
    })
  }

  const queue = createDownloadQueue({
    // The queue's changes go through `change` too, so its progress reaches the page.
    store: { ...store, update: change },
    serverOf: (serverId) => serverById({ config: config.read(), serverId }),
    servers: () => config.read().servers,
    access: deps.access,
    fetchFor: deps.fetchFor,
    calls: deps.calls,
    fs: deps.fs,
    space: deps.space,
    userData: deps.userData,
    timers: deps.timers,
    now: deps.now,
    warn: deps.warn,
    onFinished: (entry) => {
      notice(DOWNLOAD_MESSAGES.downloaded(entry.label))
      learnAndTell([entry]).catch(warnFacts)
    },
    onRemoved: forget,
    onFailed: (entry) => {
      const { status } = entry
      if (status.kind !== 'failed') return
      const why = failedMessage({
        reason: status.reason,
        message: status.message,
        serverName: serverNameOf(entry.serverId),
      })
      notice(DOWNLOAD_MESSAGES.failed({ label: entry.label, why }))
    },
  })

  const asks = createDownloadAsks({
    store,
    config,
    calls: deps.calls,
    userData: deps.userData,
    space: deps.space,
    now: deps.now,
    newId: deps.newId,
    send: deps.send,
    warn: deps.warn,
    change,
    list,
  })

  const confirm: DownloadService['confirm'] = async (input) => {
    const reply = await asks.confirm(input)
    queue.kick()
    return reply
  }

  const isKnown = (downloadId: string): boolean => entryById(store.read(), { downloadId }) !== null

  const unknown = (): DesktopReply => refused(DOWNLOAD_MESSAGES.unknown)

  const pause: DownloadService['pause'] = async ({ downloadId }) => {
    if (!isKnown(downloadId)) return unknown()
    await queue.pause({ downloadId })
    return list()
  }

  const resume: DownloadService['resume'] = ({ downloadId }) => {
    if (!isKnown(downloadId)) return unknown()
    queue.resume({ downloadId })
    return list()
  }

  const retry: DownloadService['retry'] = ({ downloadId }) => {
    if (!isKnown(downloadId)) return unknown()
    queue.retry({ downloadId })
    return list()
  }

  const remove: DownloadService['remove'] = async ({ downloadId }) => {
    if (!isKnown(downloadId)) return unknown()
    await queue.remove({ downloadId })
    return list()
  }

  const setAutoDeleteOf: DownloadService['setAutoDelete'] = ({ downloadId, autoDelete }) => {
    if (!isKnown(downloadId)) return unknown()
    change((state) => setAutoDelete(state, { downloadId, autoDelete }))
    return list()
  }

  const pauseAll: DownloadService['pauseAll'] = async () => {
    await queue.pauseAll()
    return list()
  }

  const resumeAll: DownloadService['resumeAll'] = () => {
    queue.resumeAll()
    return list()
  }

  const removeAll: DownloadService['removeAll'] = async () => {
    await queue.removeAll()
    return list()
  }

  const readSpaceView: DownloadService['readSpace'] = async () => {
    const { free, total } = await readSpace({
      fs: deps.space,
      dir: downloadsDirFor({ userData: deps.userData }),
    })
    const used = store.read().entries.reduce((sum, entry) => sum + bytesOf(entry), 0)
    return { type: 'space', space: { free, total, used } }
  }

  const setDefaults: DownloadService['setDefaults'] = ({ autoDelete }) => {
    change((state) => setAutoDeleteDefault(state, { autoDelete }))
    return list()
  }

  const showFolder: DownloadService['showFolder'] = async () => {
    const dir = downloadsDirFor({ userData: deps.userData })
    await deps.space.mkdir(dir)
    deps.showItemInFolder(dir)
    return { type: 'done' }
  }

  /** Grants a download's video and remembers whose it is; null when the file has gone. */
  const grantVideo = async (entry: DownloadEntry): Promise<string | null> => {
    const result = await deps.grants.grant(videoPathOf(entry))
    if (!result.ok) return null
    downloadIdByFile.set(result.file.fileId, entry.downloadId)
    return result.file.fileId
  }

  const open: DownloadService['open'] = async ({ downloadId }) => {
    const state = store.read()
    const entry = entryById(state, { downloadId })
    if (entry === null || entry.status.kind !== 'ready') return unknown()
    const group = sortDownloads(state.entries).filter((other) => sameGroup({ a: entry, b: other }))
    const later = group
      .slice(group.indexOf(entry) + 1)
      .filter((other) => other.status.kind === 'ready')
      .slice(0, MAX_QUEUE)
    const fileId = await grantVideo(entry)
    if (fileId === null) {
      deps.warn(`raven player could not open the file of ${loggable(entry.label)}`)
      return refused(DOWNLOAD_MESSAGES.fileGone)
    }
    freshFiles.add(fileId)
    const queued = await Promise.all(
      later.map(async (other) => {
        const queuedId = await grantVideo(other)
        if (queuedId === null) {
          deps.warn(
            `raven player left ${loggable(other.label)} out of the queue: its file has gone`,
          )
        }
        return queuedId
      }),
    )
    return {
      type: 'play',
      target: {
        fileId,
        queue: queued.flatMap((queuedId) => (queuedId === null ? [] : [queuedId])),
      },
    }
  }

  const sidecarsOf: DownloadService['sidecarsOf'] = (fileId) => {
    const entry = entryOfFile(fileId)
    if (entry === null) return []
    const { serverId, mediaId } = entry
    return entry.sidecars.map(({ trackId, title, language }) => ({
      path: sidecarPathFor({ userData: deps.userData, serverId, mediaId, trackId }),
      title,
      language,
    }))
  }

  const fromLabelOf: DownloadService['fromLabelOf'] = ({ path }) => {
    const [serverId = ''] = relative(downloadsDirFor({ userData: deps.userData }), path).split(sep)
    if (!isOpaqueId(serverId)) return null
    const serverName = serverNameOf(serverId)
    return serverName === '' ? null : DOWNLOAD_MESSAGES.downloadedFrom(serverName)
  }

  const noteOpened: DownloadService['noteOpened'] = ({ fileId }) => {
    if (entryOfFile(fileId) !== null) freshFiles.add(fileId)
  }

  const notePosition: DownloadService['notePosition'] = ({ fileId, position, duration }) => {
    const file = deps.grants.fileOf(fileId)
    const entry = entryOfFile(fileId)
    if (file === null || entry === null) return
    const { downloadId } = entry
    // The facts the player state saved this position under, so the next views read its share.
    factsById.set(downloadId, { path: file.path, size: file.size, mtimeMs: file.mtimeMs })
    const isPlay = freshFiles.has(fileId)
    freshFiles.delete(fileId)
    const at = deps.now()
    change((state) =>
      noteWatched(notePending(state, { downloadId, play: isPlay, position, at }), {
        downloadId,
        position,
        duration,
        at,
      }),
    )
  }

  const notePlaying: DownloadService['notePlaying'] = ({ fileId }) => {
    playing.downloadId = fileId === null ? null : (entryOfFile(fileId)?.downloadId ?? null)
  }

  const dispose = (): void => {
    isDisposed = true
    if (announcing.timer !== undefined) deps.timers.clear(announcing.timer)
    announcing.timer = undefined
    asks.clear()
    queue.dispose()
  }

  // A launch picks up what the last run left, once the folders no download names are gone,
  // and tries again what an outage stopped. Each file the sweep kept is read for its share watched.
  const swept = queue.sweep({ wasSetAside: deps.wasSetAside })
  Promise.all([swept, deps.ready])
    .then(queue.retryOutages)
    .catch((error: unknown) => {
      deps.warn(`raven player could not resume its downloads: ${loggable(errorText(error))}`)
    })
  swept
    .then(() => learnAndTell(store.read().entries.filter(({ status }) => status.kind === 'ready')))
    .catch(warnFacts)

  return {
    ask: asks.ask,
    retryAsk: asks.retryAsk,
    confirm,
    decline: asks.decline,
    list,
    readSpace: readSpaceView,
    setDefaults,
    views,
    pause,
    resume,
    retry,
    remove,
    setAutoDelete: setAutoDeleteOf,
    pauseAll,
    resumeAll,
    removeAll,
    removeServer: queue.removeServer,
    showFolder,
    open,
    sidecarsOf,
    fromLabelOf,
    labelOf: ({ path }) => entryAt(path)?.label ?? null,
    noteOpened,
    notePosition,
    notePlaying,
    onSuspend: queue.onSuspend,
    onResume: queue.onResume,
    dispose,
  }
}
