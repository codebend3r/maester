import { isMediaId, type DownloadTarget } from '@raven/core'
import type { ConfigStore } from '@/main/desktopConfig'
import { DOWNLOAD_MESSAGES } from '@/main/downloads/downloadMessages'
import {
  entryByMedia,
  isFileSize,
  NO_PENDING,
  queue,
  setAutoDeleteDefault,
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
import {
  isContainerName,
  SERVER_GONE,
  type DesktopEvent,
  type DesktopReply,
  type DownloadAskStatus,
} from '@/shared/protocol'

/** How long main holds an expanded link for the page to answer. */
export const ASK_TTL_MS = 600_000

export type DownloadAsksDeps = {
  store: DownloadsStore
  config: ConfigStore
  calls: Pick<ServerCalls, 'call'>
  userData: string
  space: SpaceFs
  now: () => number
  newId: () => string
  send: (event: DesktopEvent) => void
  warn: (message: string) => void
  /** Applies a change to the downloads, so the page hears it. */
  change: (apply: (state: DownloadsState) => DownloadsState) => void
  /** The downloads as the page reads them, which a confirmation answers. */
  list: () => DesktopReply
}

export type DownloadAsks = {
  ask: (input: { serverId: string; target: DownloadTarget }) => Promise<DesktopReply>
  retryAsk: (input: { askId: string }) => Promise<DesktopReply>
  confirm: (input: { askId: string; autoDelete: boolean }) => Promise<DesktopReply>
  decline: (input: { askId: string }) => DesktopReply
  /** Drops every held ask. */
  clear: () => void
}

/** A link main has expanded, waiting on the page's answer. */
type HeldAsk = { serverId: string; target: DownloadTarget; expansion: Expansion; at: number }

type Server = { serverId: string; serverName: string }

const refused = (message: string): DesktopReply => ({ type: 'refused', message })

/**
 * Each file becomes `<mediaId>/video.<container>` on disk, so both must be safe to name a file
 * by, and its size must be bytes a fetch can end at.
 */
const isStorable = ({ media }: ExpandedFile): boolean =>
  isMediaId(media.id) && isContainerName(media.container) && isFileSize(media.size)

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

/** The asks a download link raises: expanded, held for the page's answer, then queued or dropped. */
export const createDownloadAsks = (deps: DownloadAsksDeps): DownloadAsks => {
  const { store, config, now, change } = deps
  const asks = new Map<string, HeldAsk>()

  const serverOf = (serverId: string): Server | null => {
    const server = serverById(config.read(), { serverId })
    return server === null ? null : { serverId, serverName: server.name }
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

  const ask: DownloadAsks['ask'] = async ({ serverId, target }) => {
    dropExpired()
    const server = serverOf(serverId)
    if (server === null) return refused(SERVER_GONE)
    return expandUnder({ askId: deps.newId(), server, target })
  }

  const retryAsk: DownloadAsks['retryAsk'] = async ({ askId }) => {
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

  const confirm: DownloadAsks['confirm'] = async ({ askId, autoDelete }) => {
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
    // The dialog's checkbox starts from the last choice made, so the choice becomes the default.
    change((state) => setAutoDeleteDefault(queue(state, { entries }), { autoDelete }))
    const [first] = fresh
    if (first !== undefined) {
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
    return deps.list()
  }

  const decline: DownloadAsks['decline'] = ({ askId }) => {
    asks.delete(askId)
    return { type: 'done' }
  }

  return { ask, retryAsk, confirm, decline, clear: () => asks.clear() }
}
