import { isMediaId, type DownloadTarget } from '@raven/core'
import type { ConfigStore } from '@/main/desktopConfig'
import { DOWNLOAD_MESSAGES } from '@/main/downloads/downloadMessages'
import {
  bytesOf,
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
  EXPAND_REASONS,
  expandTarget,
  type ExpandedFile,
  type Expansion,
} from '@/main/downloads/expand'
import { downloadsDirFor, fits, readSpace, type SpaceFs } from '@/main/downloads/space'
import { loggable, type ServerCalls } from '@/main/servers/serverCalls'
import { serverById } from '@/main/servers/serverList'
import {
  ACCOUNT_STATES,
  DESKTOP_EVENTS,
  DESKTOP_REPLIES,
  DOWNLOAD_ASK_KINDS,
  DOWNLOAD_STATUS_KINDS,
  isContainerName,
  SERVER_GONE,
  type AccountView,
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
  /** Whether the server's accounts are ready, read as playback reads it. Never rejects. */
  isReady: (server: { id: string; name: string }) => Promise<boolean>
  /** The server's account as the page may see it. */
  readAccount: (serverId: string) => Promise<AccountView>
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

const refused = (message: string): DesktopReply => ({ type: DESKTOP_REPLIES.refused, message })

/** The account states that keep a server's titles back until the person signs in or is let in. */
const HELD_BACK: ReadonlySet<AccountView['state']> = new Set([
  ACCOUNT_STATES.signedOut,
  ACCOUNT_STATES.pending,
  ACCOUNT_STATES.revoked,
])

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
  status: { kind: DOWNLOAD_STATUS_KINDS.queued },
  autoDelete,
  watchedAt: null,
  serverPosition: file.media.position,
  pending: NO_PENDING,
  createdAt,
})

/** The asks a download link raises: expanded, held for the page's answer, then queued or dropped. */
export const createDownloadAsks = (deps: DownloadAsksDeps): DownloadAsks => {
  const { store, config, now, change } = deps
  const asks = new Map<string, HeldAsk>()

  const serverOf = (serverId: string): Server | null => {
    const server = serverById({ config: config.read(), serverId })
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
    // The files already on their way take their room first; the dialog names only the new ones.
    const owed = store
      .read()
      .entries.filter(
        ({ status }) =>
          status.kind === DOWNLOAD_STATUS_KINDS.queued ||
          status.kind === DOWNLOAD_STATUS_KINDS.downloading,
      )
      .reduce((sum, entry) => sum + Math.max(entry.size - bytesOf(entry), 0), 0)
    return {
      kind: DOWNLOAD_ASK_KINDS.ready,
      title: expansion.title,
      downloadKind: expansion.kind,
      files: expansion.files.length,
      bytes,
      free,
      fits: fits({ bytes: bytes + owed, free }),
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
      case EXPAND_REASONS.locked:
        return { ok: true, status: { kind: DOWNLOAD_ASK_KINDS.locked } }
      case EXPAND_REASONS.hidden:
        return { ok: true, status: { kind: DOWNLOAD_ASK_KINDS.hidden } }
      case EXPAND_REASONS.gone:
      case EXPAND_REASONS.unreachable:
      case EXPAND_REASONS.tooMany:
      case EXPAND_REASONS.unreadable:
      // An account held back is asked for before this; one main reads as let in is refused with why.
      case EXPAND_REASONS.account:
        return { ok: false, message: expansion.message }
      default: {
        const unreachable: never = expansion.reason
        return unreachable
      }
    }
  }

  /**
   * The account that keeps the server's titles back, or null. One that cannot be read is no reason
   * to hold the ask: the server refuses what the account may not have, and that is asked for then.
   */
  const heldBackAccount = async (serverId: string): Promise<AccountView | null> => {
    const account = await deps.readAccount(serverId).catch(() => null)
    return account !== null && HELD_BACK.has(account.state) ? account : null
  }

  const askReply = ({
    askId,
    server,
    status,
  }: {
    askId: string
    server: Server
    status: DownloadAskStatus
  }): DesktopReply => ({
    type: DESKTOP_REPLIES.downloadAsk,
    ask: {
      askId,
      serverId: server.serverId,
      serverName: server.serverName,
      autoDelete: store.read().autoDeleteDefault,
      status,
    },
  })

  /** Holds the ask until the account is let in; a confirmation meanwhile is refused with why. */
  const holdForAccount = ({
    askId,
    server,
    target,
    account,
  }: {
    askId: string
    server: Server
    target: DownloadTarget
    account: AccountView
  }): DesktopReply => {
    const expansion: Expansion = {
      ok: false,
      reason: EXPAND_REASONS.account,
      message: EXPAND_MESSAGES.account(server.serverName),
    }
    asks.set(askId, { serverId: server.serverId, target, expansion, at: now() })
    return askReply({
      askId,
      server,
      status: { kind: DOWNLOAD_ASK_KINDS.account, account },
    })
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
    // As the web does, raven player asks for an approved account first, whether or not the server
    // enforces it yet.
    const isReady = await deps.isReady({ id: serverId, name: serverName })
    const account = isReady ? await heldBackAccount(serverId) : null
    if (account !== null) return holdForAccount({ askId, server, target, account })
    const expansion = await expandTarget({
      calls: deps.calls,
      serverId,
      serverName,
      hasAccounts: isReady,
      target,
      skip: (mediaId) => entryByMedia(store.read(), { serverId, mediaId }) !== null,
    })
    if (!expansion.ok && expansion.reason === EXPAND_REASONS.account) {
      const refusedAccount = await heldBackAccount(serverId)
      if (refusedAccount !== null) {
        return holdForAccount({ askId, server, target, account: refusedAccount })
      }
    }
    const outcome = await statusOf({ expansion, serverName })
    if (!outcome.ok) {
      asks.delete(askId)
      return refused(outcome.message)
    }
    asks.set(askId, { serverId, target, expansion, at: now() })
    return askReply({ askId, server, status: outcome.status })
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
    // A locked ask, or one waiting on its account, waits for its retry; the page offers no Download until then.
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
        type: DESKTOP_EVENTS.notice,
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
    return { type: DESKTOP_REPLIES.done }
  }

  return { ask, retryAsk, confirm, decline, clear: () => asks.clear() }
}
