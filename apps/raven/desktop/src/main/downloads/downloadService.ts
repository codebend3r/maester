import type { ConfigStore } from '@/main/desktopConfig'
import { createDownloadAsks, type DownloadAsks } from '@/main/downloads/asks'
import { DOWNLOAD_MESSAGES } from '@/main/downloads/downloadMessages'
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
  type DownloadsState,
} from '@/main/downloads/downloadState'
import type { DownloadsStore } from '@/main/downloads/downloadStore'
import type { MediaAccess } from '@/main/downloads/mediaAccess'
import { downloadsDirFor, readSpace, type SpaceFs } from '@/main/downloads/space'
import { errorText } from '@/main/log/errorText'
import { loggable, type ServerCalls } from '@/main/servers/serverCalls'
import { serverById } from '@/main/servers/serverList'
import type { Timers } from '@/main/stateStore'
import type { DesktopEvent, DesktopReply, DownloadView } from '@/shared/protocol'

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
  /** Stops the events and every fetch; after it the page hears nothing more. */
  dispose: () => void
}

/** The list as both the `downloads` reply and the `downloads` event carry it. */
type DownloadsList = Extract<DesktopEvent, { type: 'downloads' }>

const refused = (message: string): DesktopReply => ({ type: 'refused', message })

export const createDownloadService = (deps: DownloadServiceDeps): DownloadService => {
  const { store, config } = deps
  const announcing: { timer: unknown } = { timer: undefined }
  let isDisposed = false

  const serverNameOf = (serverId: string): string =>
    serverById(config.read(), { serverId })?.name ?? ''

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
        status: entry.status,
        autoDelete: entry.autoDelete,
        watched: null,
        deletesAt: null,
        needsUnlock:
          entry.status.kind === 'paused' &&
          entry.status.message === DOWNLOAD_MESSAGES.relocked(serverName),
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
    announcing.timer = deps.timers.set(() => {
      announcing.timer = undefined
      deps.send(list())
    }, DOWNLOADS_EVENT_MS)
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

  const queue = createDownloadQueue({
    // The queue's changes go through `change` too, so its progress reaches the page.
    store: { ...store, update: change },
    serverOf: (serverId) => serverById(config.read(), { serverId }),
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
    onFinished: (entry) => notice(DOWNLOAD_MESSAGES.downloaded(entry.label)),
    onFailed: (entry) => {
      if (entry.status.kind !== 'failed') return
      notice(DOWNLOAD_MESSAGES.failed({ label: entry.label, why: entry.status.message }))
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

  const dispose = (): void => {
    isDisposed = true
    if (announcing.timer !== undefined) deps.timers.clear(announcing.timer)
    announcing.timer = undefined
    asks.clear()
    queue.dispose()
  }

  // A launch picks up what the last run left, once the folders no download names are gone.
  Promise.all([queue.sweep(), deps.ready])
    .then(queue.kick)
    .catch((error: unknown) => {
      deps.warn(`raven player could not resume its downloads: ${loggable(errorText(error))}`)
    })

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
    dispose,
  }
}
