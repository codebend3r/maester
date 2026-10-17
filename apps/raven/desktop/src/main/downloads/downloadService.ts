import { isMediaId, type DownloadTarget } from '@raven/core'
import type { ConfigStore } from '@/main/desktopConfig'
import {
  bytesOf,
  entryByMedia,
  NO_PENDING,
  queue,
  setAutoDeleteDefault,
  sortDownloads,
  type DownloadEntry,
  type DownloadsState,
} from '@/main/downloads/downloadState'
import type { DownloadsStore } from '@/main/downloads/downloadStore'
import {
  EXPAND_MESSAGES,
  expandTarget,
  type ExpandedFile,
  type Expansion,
} from '@/main/downloads/expand'
import { downloadsDirFor, fits, readSpace, type SpaceFs } from '@/main/downloads/space'
import { loggable, type ServerCalls } from '@/main/servers/serverCalls'
import { serverById } from '@/main/servers/serverList'
import type { Timers } from '@/main/stateStore'
import {
  isContainerName,
  SERVER_GONE,
  type DesktopEvent,
  type DesktopReply,
  type DownloadAskStatus,
  type DownloadKind,
  type DownloadView,
} from '@/shared/protocol'

/** How long main holds an expanded link for the page to answer. */
export const ASK_TTL_MS = 600_000

/** The `downloads` event goes out at most once in this long, so progress cannot flood the page. */
export const DOWNLOADS_EVENT_MS = 250

/** What the files of an ask of each kind are called, many at a time. */
const FILE_NOUNS = {
  movie: 'movies',
  saga: 'movies',
  episode: 'episodes',
  season: 'episodes',
  show: 'episodes',
} as const satisfies Record<DownloadKind, string>

export const DOWNLOAD_MESSAGES = {
  askGone:
    'That download request has expired. Open the title in raven on the web and choose Download to raven player again.',
  unknown: 'That download is no longer in raven player.',
  queued: ({
    files,
    kind,
    label,
    serverName,
  }: {
    files: number
    kind: DownloadKind
    label: string
    serverName: string
  }): string =>
    files === 1
      ? `Downloading ${label} from ${serverName}`
      : `Downloading ${files} ${FILE_NOUNS[kind]} from ${serverName}`,
  noSpace: 'Not enough space',
  changed: 'The file changed on the server',
  relocked: (name: string): string => `${name} locked this library again`,
  downloaded: (label: string): string => `Downloaded ${label}`,
  failed: ({ label, why }: { label: string; why: string }): string =>
    `Could not download ${label}: ${why}`,
  deletedAfterWatching: (label: string): string => `Deleted ${label} after watching`,
} as const

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

export type DownloadService = {
  ask: (input: { serverId: string; target: DownloadTarget }) => Promise<DesktopReply>
  retryAsk: (input: { askId: string }) => Promise<DesktopReply>
  confirm: (input: { askId: string; autoDelete: boolean }) => Promise<DesktopReply>
  decline: (input: { askId: string }) => DesktopReply
  list: () => DesktopReply
  readSpace: () => Promise<DesktopReply>
  setDefaults: (input: { autoDelete: boolean }) => DesktopReply
  views: () => DownloadView[]
  dispose: () => void
}

/** A link main has expanded, waiting on the page's answer. */
type HeldAsk = { serverId: string; target: DownloadTarget; expansion: Expansion; at: number }

/** The list as both the `downloads` reply and the `downloads` event carry it. */
type DownloadsList = Extract<DesktopEvent, { type: 'downloads' }>

type Server = { serverId: string; serverName: string }

const refused = (message: string): DesktopReply => ({ type: 'refused', message })

/** Each file becomes `<mediaId>/video.<container>` on disk, so both must be safe to name a file by. */
const isStorable = ({ media }: ExpandedFile): boolean =>
  isMediaId(media.id) && isContainerName(media.container)

const entryOf = ({
  file,
  downloadId,
  serverId,
  autoDelete,
  createdAt,
}: {
  file: ExpandedFile
  downloadId: string
  serverId: string
  autoDelete: boolean
  createdAt: number
}): DownloadEntry => ({
  downloadId,
  serverId,
  mediaId: file.media.id,
  label: file.label,
  group: file.group,
  container: file.media.container,
  size: file.media.size,
  duration: file.media.duration,
  watchedPercent: file.watchedPercent,
  sidecars: [],
  status: { kind: 'queued' },
  autoDelete,
  watchedAt: null,
  pending: NO_PENDING,
  createdAt,
})

export const createDownloadService = (deps: DownloadServiceDeps): DownloadService => {
  const { store, config, now } = deps
  const asks = new Map<string, HeldAsk>()
  const announcing: { timer: unknown } = { timer: undefined }

  const serverOf = (serverId: string): Server | null => {
    const server = serverById(config.read(), { serverId })
    return server === null ? null : { serverId, serverName: server.name }
  }

  const views = (): DownloadView[] =>
    sortDownloads(store.read().entries).map((entry) => ({
      downloadId: entry.downloadId,
      label: entry.label,
      group: entry.group,
      serverName: serverOf(entry.serverId)?.serverName ?? '',
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

  const dropExpired = (): void => {
    const oldest = now() - ASK_TTL_MS
    asks.forEach((held, askId) => {
      if (held.at < oldest) asks.delete(askId)
    })
  }

  const readyStatus = async (
    expansion: Extract<Expansion, { ok: true }>,
  ): Promise<DownloadAskStatus> => {
    const bytes = expansion.files.reduce((sum, file) => sum + file.media.size, 0)
    const { free } = await readSpace({
      fs: deps.space,
      dir: downloadsDirFor({ userData: deps.userData }),
    })
    return {
      kind: 'ready',
      title: expansion.title,
      downloadKind: expansion.kind,
      files: expansion.files.length,
      bytes,
      free,
      fits: fits({ bytes, free }),
    }
  }

  /** The ask's status, or why there is no ask to hold. */
  const statusOf = async ({
    expansion,
    serverName,
  }: {
    expansion: Expansion
    serverName: string
  }): Promise<{ ok: true; status: DownloadAskStatus } | { ok: false; message: string }> => {
    if (expansion.ok) {
      const unstorable = expansion.files.find((file) => !isStorable(file))
      if (unstorable !== undefined) {
        deps.warn(
          `${loggable(serverName)} named an unusable file for ${loggable(unstorable.label)}`,
        )
        return { ok: false, message: EXPAND_MESSAGES.unreadable(serverName) }
      }
      return { ok: true, status: await readyStatus(expansion) }
    }
    switch (expansion.reason) {
      case 'locked':
        return { ok: true, status: { kind: 'locked' } }
      case 'hidden':
        return { ok: true, status: { kind: 'hidden' } }
      case 'gone':
      case 'unreachable':
      case 'tooMany':
      case 'unreadable':
        return { ok: false, message: expansion.message }
      default: {
        const unreachable: never = expansion.reason
        return unreachable
      }
    }
  }

  /** Expands `target` and holds it under `askId`; a refusal holds nothing, so a retry of it is gone. */
  const expandUnder = async ({
    askId,
    server,
    target,
  }: {
    askId: string
    server: Server
    target: DownloadTarget
  }): Promise<DesktopReply> => {
    const { serverId, serverName } = server
    const expansion = await expandTarget({
      calls: deps.calls,
      serverId,
      serverName,
      target,
      skip: (mediaId) => entryByMedia(store.read(), { serverId, mediaId }) !== null,
    })
    const outcome = await statusOf({ expansion, serverName })
    if (!outcome.ok) {
      asks.delete(askId)
      return refused(outcome.message)
    }
    asks.set(askId, { serverId, target, expansion, at: now() })
    return {
      type: 'downloadAsk',
      ask: {
        askId,
        serverId,
        serverName,
        autoDelete: store.read().autoDeleteDefault,
        status: outcome.status,
      },
    }
  }

  const ask: DownloadService['ask'] = async ({ serverId, target }) => {
    dropExpired()
    const server = serverOf(serverId)
    if (server === null) return refused(SERVER_GONE)
    return expandUnder({ askId: deps.newId(), server, target })
  }

  const retryAsk: DownloadService['retryAsk'] = async ({ askId }) => {
    dropExpired()
    const held = asks.get(askId)
    if (held === undefined) return refused(DOWNLOAD_MESSAGES.askGone)
    const server = serverOf(held.serverId)
    if (server === null) {
      asks.delete(askId)
      return refused(SERVER_GONE)
    }
    return expandUnder({ askId, server, target: held.target })
  }

  const confirm: DownloadService['confirm'] = async ({ askId, autoDelete }) => {
    dropExpired()
    const held = asks.get(askId)
    if (held === undefined) return refused(DOWNLOAD_MESSAGES.askGone)
    const { expansion } = held
    // A locked ask waits for its retry; the page offers no Download until then.
    if (!expansion.ok) return refused(expansion.message)
    const server = serverOf(held.serverId)
    asks.delete(askId)
    if (server === null) return refused(SERVER_GONE)
    const { serverId } = server
    // A file queued since the ask, by another ask or another link, is not queued twice.
    const fresh = expansion.files.filter(
      (file) => entryByMedia(store.read(), { serverId, mediaId: file.media.id }) === null,
    )
    const createdAt = now()
    const entries = fresh.map((file) =>
      entryOf({ file, downloadId: deps.newId(), serverId, autoDelete, createdAt }),
    )
    const [first] = fresh
    if (first !== undefined) {
      change((state) => queue(state, { entries }))
      deps.send({
        type: 'notice',
        message: DOWNLOAD_MESSAGES.queued({
          files: fresh.length,
          kind: expansion.kind,
          label: first.label,
          serverName: server.serverName,
        }),
      })
    }
    return list()
  }

  const decline: DownloadService['decline'] = ({ askId }) => {
    asks.delete(askId)
    return { type: 'done' }
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

  const dispose = (): void => {
    if (announcing.timer !== undefined) deps.timers.clear(announcing.timer)
    announcing.timer = undefined
    asks.clear()
  }

  return {
    ask,
    retryAsk,
    confirm,
    decline,
    list,
    readSpace: readSpaceView,
    setDefaults,
    views,
    dispose,
  }
}
