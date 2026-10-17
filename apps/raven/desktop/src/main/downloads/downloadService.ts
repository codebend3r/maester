import type { ConfigStore } from '@/main/desktopConfig'
import { createDownloadAsks, type DownloadAsks } from '@/main/downloads/asks'
import {
  bytesOf,
  setAutoDeleteDefault,
  sortDownloads,
  type DownloadsState,
} from '@/main/downloads/downloadState'
import type { DownloadsStore } from '@/main/downloads/downloadStore'
import { downloadsDirFor, readSpace, type SpaceFs } from '@/main/downloads/space'
import type { ServerCalls } from '@/main/servers/serverCalls'
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
}

export type DownloadService = Pick<DownloadAsks, 'ask' | 'retryAsk' | 'confirm' | 'decline'> & {
  list: () => DesktopReply
  readSpace: () => Promise<DesktopReply>
  setDefaults: (input: { autoDelete: boolean }) => DesktopReply
  views: () => DownloadView[]
  dispose: () => void
}

/** The list as both the `downloads` reply and the `downloads` event carry it. */
type DownloadsList = Extract<DesktopEvent, { type: 'downloads' }>

export const createDownloadService = (deps: DownloadServiceDeps): DownloadService => {
  const { store, config } = deps
  const announcing: { timer: unknown } = { timer: undefined }

  const views = (): DownloadView[] =>
    sortDownloads(store.read().entries).map((entry) => ({
      downloadId: entry.downloadId,
      label: entry.label,
      group: entry.group,
      serverName: serverById(config.read(), { serverId: entry.serverId })?.name ?? '',
      size: entry.size,
      status: entry.status,
      autoDelete: entry.autoDelete,
      watched: null,
      deletesAt: null,
      needsUnlock: false,
    }))

  const list = (): DownloadsList => ({
    type: 'downloads',
    downloads: views(),
    autoDeleteDefault: store.read().autoDeleteDefault,
  })

  // The list is read when the timer fires, so every change folded into it is in it.
  const announce = (): void => {
    if (announcing.timer !== undefined) return
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

  const dispose = (): void => {
    if (announcing.timer !== undefined) deps.timers.clear(announcing.timer)
    announcing.timer = undefined
    asks.clear()
  }

  return {
    ask: asks.ask,
    retryAsk: asks.retryAsk,
    confirm: asks.confirm,
    decline: asks.decline,
    list,
    readSpace: readSpaceView,
    setDefaults,
    views,
    dispose,
  }
}
