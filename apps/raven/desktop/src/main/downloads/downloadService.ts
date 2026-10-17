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
  setAutoDelete,
  setAutoDeleteDefault,
  sortDownloads,
  type EntryStatus,
  type DownloadsState,
} from '@/main/downloads/downloadState'
import type { DownloadsStore } from '@/main/downloads/downloadStore'
import type { MediaAccess } from '@/main/downloads/mediaAccess'
import {
  createDownloadPlayback,
  type DownloadPlayback,
  type DownloadPlaybackDeps,
} from '@/main/downloads/playback'
import { downloadsDirFor, readSpace, type SpaceFs } from '@/main/downloads/space'
import { createSync, settleWithin } from '@/main/downloads/sync'
import { errorText } from '@/main/log/errorText'
import { loggable, type ServerCalls } from '@/main/servers/serverCalls'
import { serverById } from '@/main/servers/serverList'
import type { Timers } from '@/main/stateStore'
import type { DesktopEvent, DesktopReply, DownloadStatus, DownloadView } from '@/shared/protocol'

/** The `downloads` event goes out at most once in this long, so progress cannot flood the page. */
export const DOWNLOADS_EVENT_MS = 250

/** A deletion waits this long at most for the server to hear what was watched, then deletes anyway. */
export const SYNC_DELETE_WAIT_MS = 2000

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
} & Pick<DownloadPlaybackDeps, 'grants' | 'state' | 'stat'>

type ById = { downloadId: string }

export type DownloadService = Pick<DownloadAsks, 'ask' | 'retryAsk' | 'confirm' | 'decline'> &
  Pick<
    DownloadPlayback,
    | 'open'
    | 'nextOf'
    | 'sidecarsOf'
    | 'fromLabelOf'
    | 'labelOf'
    | 'serverPositionOf'
    | 'noteOpened'
    | 'notePosition'
    | 'notePlaying'
    | 'isWatched'
  > & {
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

export const createDownloadService = (deps: DownloadServiceDeps): DownloadService => {
  const { store, config } = deps
  const announcing: { timer: unknown } = { timer: undefined }
  let isDisposed = false

  const serverNameOf = (serverId: string): string =>
    serverById({ config: config.read(), serverId })?.name ?? ''

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
        watched: playback.watchedOf(entry.downloadId),
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

  const sync = createSync({ store, calls: deps.calls, timers: deps.timers, warn: deps.warn })

  const runSync = (work: Promise<void>): void => {
    work.catch((error: unknown) => {
      deps.warn(
        `raven player could not tell its servers what was watched: ${loggable(errorText(error))}`,
      )
    })
  }

  const waitForSync = (work: Promise<void>): Promise<void> =>
    settleWithin({ work, timers: deps.timers, ms: SYNC_DELETE_WAIT_MS, warn: deps.warn })

  const playback = createDownloadPlayback({
    store,
    userData: deps.userData,
    grants: deps.grants,
    state: deps.state,
    stat: deps.stat,
    now: deps.now,
    warn: deps.warn,
    serverNameOf,
    change,
    announce,
    onNoted: sync.touch,
  })

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
      playback.readFiles([entry])
    },
    onRemoved: playback.forget,
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

  // Only the page asking for the list sends what is pending; the list that events and replies carry does not.
  const listAndSync: DownloadService['list'] = () => {
    runSync(sync.runAll())
    return list()
  }

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
    await waitForSync(sync.runFor({ downloadIds: [downloadId] }))
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
    await waitForSync(sync.runAll())
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

  const dispose = (): void => {
    isDisposed = true
    if (announcing.timer !== undefined) deps.timers.clear(announcing.timer)
    announcing.timer = undefined
    asks.clear()
    sync.dispose()
    queue.dispose()
  }

  // A launch picks up what the last run left, once the folders no download names are gone,
  // reads each file it kept for its share watched, and tries again what an outage stopped.
  const resumeLaunch = async (): Promise<void> => {
    await Promise.all([queue.sweep({ wasSetAside: deps.wasSetAside }), deps.ready])
    playback.readFiles(store.read().entries.filter(({ status }) => status.kind === 'ready'))
    queue.retryOutages()
    await sync.runAll()
  }
  resumeLaunch().catch((error: unknown) => {
    deps.warn(`raven player could not resume its downloads: ${loggable(errorText(error))}`)
  })

  return {
    ask: asks.ask,
    retryAsk: asks.retryAsk,
    confirm,
    decline: asks.decline,
    list: listAndSync,
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
    open: playback.open,
    nextOf: playback.nextOf,
    sidecarsOf: playback.sidecarsOf,
    fromLabelOf: playback.fromLabelOf,
    labelOf: playback.labelOf,
    serverPositionOf: playback.serverPositionOf,
    noteOpened: playback.noteOpened,
    notePosition: playback.notePosition,
    notePlaying: playback.notePlaying,
    isWatched: playback.isWatched,
    onSuspend: queue.onSuspend,
    onResume: queue.onResume,
    dispose,
  }
}
