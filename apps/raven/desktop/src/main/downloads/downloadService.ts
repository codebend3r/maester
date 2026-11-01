import {
  DESKTOP_EVENTS,
  DESKTOP_REPLIES,
  type DesktopEvent,
  type DesktopReply,
  DOWNLOAD_ARTWORK_KINDS,
  DOWNLOAD_STATUS_KINDS,
  type DownloadStatus,
  type DownloadView,
} from '@raven/core'
import { type ConfigStore, serverById, serverOf, setLastAccount } from '@/main/desktopConfig'
import { createDownloadAsks, type DownloadAsks } from '@/main/downloads/asks'
import { factsBefore } from '@/main/downloads/artwork'
import { createAutoDelete, isDueForDeletion } from '@/main/downloads/autoDelete'
import { DOWNLOAD_MESSAGES, failedMessage, pausedMessage } from '@/main/downloads/downloadMessages'
import {
  createDownloadQueue,
  type DownloadQueueDeps,
  type QueueFs,
} from '@/main/downloads/downloadQueue'
import {
  bytesOf,
  entryById,
  PAUSE_REASONS,
  oweOtherAccounts,
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
import { DONE, refused } from '@/main/replies'
import { loggable, type ServerCalls } from '@/main/servers/serverCalls'
import type { Timers } from '@/main/stateStore'

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
  fetch: DownloadQueueDeps['fetch']
  fs: QueueFs
  showItemInFolder: (path: string) => void
  /** Settles once the network can be used (main's `app.whenReady()`); the launch's first kick waits on it. */
  ready: Promise<void>
  /** `downloads.json` could not be read and was set aside, so the launch sweep keeps every folder. */
  wasSetAside: boolean
  /** How often the sync tries its servers again; the spec's five minutes unless main's test hook shortens it. */
  syncRetryMs: number
} & Pick<DownloadPlaybackDeps, 'grants' | 'state' | 'stat' | 'accountIdOf'>

type ById = { downloadId: string }

type SetDefaultsProps = { autoDelete: boolean }

type AccessEndedProps = { serverId: string }

type AccountSwitchedProps = { serverId: string }

export type DownloadService = Pick<DownloadAsks, 'ask' | 'retryAsk' | 'confirm' | 'decline'> &
  Pick<
    DownloadPlayback,
    | 'open'
    | 'openTitle'
    | 'nextOf'
    | 'sidecarsOf'
    | 'fromLabelOf'
    | 'labelOf'
    | 'isStaleDownload'
    | 'serverPositionOf'
    | 'noteOpened'
    | 'notePosition'
    | 'notePlaying'
    | 'playbackLeft'
    | 'isWatched'
  > & {
    list: () => DesktopReply
    readSpace: () => Promise<DesktopReply>
    setDefaults: (input: SetDefaultsProps) => DesktopReply
    views: () => DownloadView[]
    pause: (input: ById) => Promise<DesktopReply>
    resume: (input: ById) => DesktopReply
    retry: (input: ById) => DesktopReply
    remove: (input: ById) => Promise<DesktopReply>
    setAutoDelete: (input: ById & { autoDelete: boolean }) => DesktopReply
    pauseAll: () => Promise<DesktopReply>
    resumeAll: () => DesktopReply
    removeAll: () => Promise<DesktopReply>
    /**
     * The page said ready: a new page, on no file, since a reload mid-play left no unmount to
     * say the page left its file. The first one starts the clocks of what deletes once watched,
     * so what they tell at launch reaches a page that listens.
     */
    pageReady: () => void
    showFolder: () => Promise<DesktopReply>
    /** Main's `powerMonitor` `suspend`: every fetch stops and its file waits for the wake. */
    onSuspend: () => void
    /** Main's `powerMonitor` `resume`: files start again once the network has had a moment. */
    onResume: () => void
    /** A server's sign-in ended in main: its downloads fetched with an account ticket fail. */
    accessEnded: (input: AccessEndedProps) => void
    /**
     * The account signed in to a server changed: what its downloads hold for any other account
     * waits in `owed` for that account, and what the one signed in now is owed goes out. An
     * account signed in is kept in the config as the last one, which a play while none is waits for.
     */
    accountSwitched: (input: AccountSwitchedProps) => void
    /** Stops the events and every fetch; after it the page hears nothing more. */
    dispose: () => void
  }

/** The list as both the `downloads` reply and the `downloads` event carry it. */
type DownloadsList = Extract<DesktopEvent, { type: typeof DESKTOP_EVENTS.downloads }>

type ViewStatusOfProps = {
  status: EntryStatus
  serverName: string
}

/** A stored status as the page reads it: its reason in words, named by the server's name now. */
export const viewStatusOf = ({ status, serverName }: ViewStatusOfProps): DownloadStatus => {
  switch (status.kind) {
    case DOWNLOAD_STATUS_KINDS.queued:
    case DOWNLOAD_STATUS_KINDS.downloading:
    case DOWNLOAD_STATUS_KINDS.ready:
      return status
    case DOWNLOAD_STATUS_KINDS.paused:
      return {
        kind: DOWNLOAD_STATUS_KINDS.paused,
        bytes: status.bytes,
        message: pausedMessage({ reason: status.reason, serverName }),
      }
    case DOWNLOAD_STATUS_KINDS.failed:
      return {
        kind: DOWNLOAD_STATUS_KINDS.failed,
        bytes: status.bytes,
        message: failedMessage({ reason: status.reason, message: status.message, serverName }),
      }
    default: {
      const unreachable: never = status
      return unreachable
    }
  }
}

/** The reply to a request naming a download the list no longer holds. */
const UNKNOWN_DOWNLOAD = refused(DOWNLOAD_MESSAGES.unknown)

export const createDownloadService = (deps: DownloadServiceDeps): DownloadService => {
  const { store, config } = deps
  const announcing: { timer: unknown } = { timer: undefined }
  let isDisposed = false
  const firstPage: { ready: () => void } = { ready: () => undefined }
  const isPageReady = new Promise<void>((resolve) => {
    firstPage.ready = resolve
  })

  // Declared before everything that reads it. Its own dependencies are read only once a clock
  // runs, after construction, so they may come later.
  const deleteClock = createAutoDelete({
    store,
    timers: deps.timers,
    now: deps.now,
    isPlaying: (downloadId) => playback.isPlaying(downloadId),
    isMidTitle: (downloadId) => playback.isMidTitle(downloadId),
    // The viewer may open the file, or switch the option off, while the removal waits on the
    // server, so it looks again before it removes.
    remove: (downloadId) =>
      removeAfterSync({ downloadId, isKept: () => isKeptAfterAll(downloadId) }),
    onDeleted: (entry) => {
      notice(DOWNLOAD_MESSAGES.deletedAfterWatching(entry.label))
      announce()
    },
    warn: deps.warn,
  })

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
        shouldAutoDelete: entry.autoDelete,
        watched: playback.watchedOf(entry),
        deletesAt: deleteClock.deletesAt({ downloadId: entry.downloadId }),
        isLocked:
          entry.status.kind === DOWNLOAD_STATUS_KINDS.paused &&
          entry.status.reason === PAUSE_REASONS.relocked,
        artwork: entry.artwork ?? { kind: DOWNLOAD_ARTWORK_KINDS.none },
        facts: entry.facts ?? factsBefore(entry),
        createdAt: entry.createdAt,
      }
    })

  const list = (): DownloadsList => ({
    type: DESKTOP_EVENTS.downloads,
    downloads: views(),
    shouldAutoDeleteByDefault: store.read().autoDeleteDefault,
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
    if (!isDisposed) deps.send({ type: DESKTOP_EVENTS.notice, message })
  }

  const sync = createSync({
    store,
    calls: deps.calls,
    timers: deps.timers,
    warn: deps.warn,
    retryMs: deps.syncRetryMs,
    accountIdOf: deps.accountIdOf,
  })

  const runSync = (work: Promise<void>): void => {
    work.catch((error: unknown) => {
      deps.warn(`Raven could not tell its servers what was watched: ${loggable(errorText(error))}`)
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
    // Every position noted may set when the title counts as watched, or clear the spot a held
    // deletion waits on.
    onNoted: (input) => {
      sync.touch(input)
      deleteClock.schedule(input)
    },
    onLeft: () => deleteClock.playbackLeft(),
    accountIdOf: deps.accountIdOf,
    lastAccountIdOf: ({ serverId }) =>
      serverById({ config: config.read(), serverId }) === null ? null : config.read().lastAccountId,
  })

  const queue = createDownloadQueue({
    // The queue's changes go through `change` too, so its progress reaches the page.
    store: { ...store, update: change },
    serverOf: (serverId) => serverById({ config: config.read(), serverId }),
    servers: () => [serverOf(config.read())],
    access: deps.access,
    fetch: deps.fetch,
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
    onRemoved: (entries) => {
      playback.forget(entries)
      entries.forEach(({ downloadId }) => deleteClock.cancel({ downloadId }))
    },
    // After the settle, so a deletion that came due in the sleep finds the network back and
    // the server hears what was watched first.
    onAwake: () => deleteClock.rearm(),
    onFailed: (entry) => {
      const { status } = entry
      if (status.kind !== DOWNLOAD_STATUS_KINDS.failed) return
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
    isSignedIn: ({ serverId }) => deps.accountIdOf({ serverId }) !== null,
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

  const pause: DownloadService['pause'] = async ({ downloadId }) => {
    if (!isKnown(downloadId)) return UNKNOWN_DOWNLOAD
    await queue.pause({ downloadId })
    return list()
  }

  const resume: DownloadService['resume'] = ({ downloadId }) => {
    if (!isKnown(downloadId)) return UNKNOWN_DOWNLOAD
    queue.resume({ downloadId })
    return list()
  }

  const retry: DownloadService['retry'] = ({ downloadId }) => {
    if (!isKnown(downloadId)) return UNKNOWN_DOWNLOAD
    queue.retry({ downloadId })
    return list()
  }

  type RemoveAfterSyncProps = {
    downloadId: string
    isKept: () => boolean
  }

  /**
   * Waits for the server to hear what was watched, then removes the download unless `isKept`
   * says otherwise by then. True once it removed it.
   */
  const removeAfterSync = async ({
    downloadId,
    isKept,
  }: RemoveAfterSyncProps): Promise<boolean> => {
    await waitForSync(sync.runFor({ downloadIds: [downloadId] }))
    if (isKept()) return false
    await queue.remove({ downloadId })
    return true
  }

  const isKeptAfterAll = (downloadId: string): boolean =>
    !isDueForDeletion({ entry: entryById(store.read(), { downloadId }), now: deps.now() }) ||
    playback.isPlaying(downloadId) ||
    playback.isMidTitle(downloadId)

  // The viewer's own Delete removes whatever is playing.
  const remove: DownloadService['remove'] = async ({ downloadId }) => {
    if (!isKnown(downloadId)) return UNKNOWN_DOWNLOAD
    await removeAfterSync({ downloadId, isKept: () => false })
    return list()
  }

  const setAutoDeleteOf: DownloadService['setAutoDelete'] = ({ downloadId, autoDelete }) => {
    if (!isKnown(downloadId)) return UNKNOWN_DOWNLOAD
    const at = deps.now()
    change((state) => setAutoDelete(state, { downloadId, autoDelete, at }))
    if (autoDelete) deleteClock.schedule({ downloadId })
    else deleteClock.cancel({ downloadId })
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
    return { type: DESKTOP_REPLIES.space, space: { free, total, used } }
  }

  const setDefaults: DownloadService['setDefaults'] = ({ autoDelete }) => {
    change((state) => setAutoDeleteDefault(state, { autoDelete }))
    return list()
  }

  const showFolder: DownloadService['showFolder'] = async () => {
    const dir = downloadsDirFor({ userData: deps.userData })
    await deps.space.mkdir(dir)
    deps.showItemInFolder(dir)
    return DONE
  }

  type KeepLastAccountProps = {
    serverId: string
    accountId: string | null
  }

  const keepLastAccount = ({ serverId, accountId }: KeepLastAccountProps): void => {
    const current = config.read()
    if (accountId === null || current.lastAccountId === accountId) return
    if (serverById({ config: current, serverId }) === null) return
    config.update((latest) => setLastAccount({ config: latest, accountId }))
  }

  const accountSwitched: DownloadService['accountSwitched'] = ({ serverId }) => {
    const accountId = deps.accountIdOf({ serverId })
    keepLastAccount({ serverId, accountId })
    change((state) => oweOtherAccounts(state, { serverId, accountId }))
    runSync(sync.runAll())
  }

  const dispose = (): void => {
    isDisposed = true
    if (announcing.timer !== undefined) deps.timers.clear(announcing.timer)
    announcing.timer = undefined
    asks.clear()
    sync.dispose()
    deleteClock.dispose()
    queue.dispose()
  }

  // `send` drops an event while there is no window, so a deletion due at once waits for the
  // first page to say ready before it tells of itself. A page that never does starts none.
  const startClocks = async (): Promise<void> => {
    await isPageReady
    if (isDisposed) return
    deleteClock.rebuild()
    // The page may have listed the downloads before their clocks ran.
    if (views().some(({ deletesAt }) => deletesAt !== null)) announce()
  }

  // A launch picks up what the last run left, once the folders no download names are gone,
  // reads each file it kept for its share watched, tries again what an outage stopped and
  // starts the clocks of what deletes once watched. A deletion due at once waits for the
  // network, so the server hears what was watched before the file goes.
  const resumeLaunch = async (): Promise<void> => {
    await Promise.all([queue.sweep({ wasSetAside: deps.wasSetAside }), deps.ready])
    playback.readFiles(
      store.read().entries.filter(({ status }) => status.kind === DOWNLOAD_STATUS_KINDS.ready),
    )
    queue.retryOutages()
    await Promise.all([startClocks(), sync.runAll()])
  }
  resumeLaunch().catch((error: unknown) => {
    deps.warn(`Raven could not resume its downloads: ${loggable(errorText(error))}`)
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
    pageReady: () => {
      playback.noteNewPage()
      firstPage.ready()
    },
    showFolder,
    open: playback.open,
    openTitle: playback.openTitle,
    nextOf: playback.nextOf,
    sidecarsOf: playback.sidecarsOf,
    fromLabelOf: playback.fromLabelOf,
    labelOf: playback.labelOf,
    isStaleDownload: playback.isStaleDownload,
    serverPositionOf: playback.serverPositionOf,
    noteOpened: playback.noteOpened,
    notePosition: playback.notePosition,
    notePlaying: playback.notePlaying,
    playbackLeft: playback.playbackLeft,
    isWatched: playback.isWatched,
    onSuspend: queue.onSuspend,
    onResume: queue.onResume,
    accessEnded: queue.accessEnded,
    accountSwitched,
    dispose,
  }
}
