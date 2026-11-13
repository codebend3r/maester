import {
  DESKTOP_EVENTS,
  DESKTOP_REPLIES,
  type DesktopEvent,
  type DesktopReply,
  DOWNLOAD_ASK_KINDS,
  DOWNLOAD_STATUS_KINDS,
  type DownloadAskStatus,
  type DownloadTarget,
  factsOf,
  isContainerName,
  isMediaId,
} from '@raven/core'
import { SERVER_NAME } from '@/main/desktopConfig'
import { DOWNLOAD_MESSAGES } from '@/main/downloads/downloadMessages'
import {
  bytesOf,
  entryByMedia,
  isFileSize,
  isUnderWay,
  NO_PENDING,
  queue,
  setAutoDeleteDefault,
  type DownloadEntry,
  type DownloadsState,
} from '@/main/downloads/downloadState'
import type { DownloadsStore } from '@/main/downloads/downloadStore'
import { DONE, refused } from '@/main/replies'
import {
  EXPAND_MESSAGES,
  EXPAND_REASONS,
  expandTarget,
  type ExpandedFile,
  type Expansion,
} from '@/main/downloads/expand'
import { downloadsDirFor, fits, readSpace, type SpaceFs } from '@/main/downloads/space'
import { loggable, type ServerCalls } from '@/main/servers/serverCalls'

/** How long main holds an expanded link for the page to answer. */
export const ASK_TTL_MS = 600_000

type DownloadAsksDeps = {
  store: DownloadsStore
  /** The id the server's downloads are filed under. */
  serverId: string
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
  /** Whether the page is signed in to the server, so main has an account to ask with. */
  isSignedIn: () => boolean
}

type AskProps = { target: DownloadTarget }

type RetryAskProps = { askId: string }

type ConfirmProps = { askId: string; autoDelete: boolean }

type DeclineProps = { askId: string }

export type DownloadAsks = {
  ask: (input: AskProps) => Promise<DesktopReply>
  retryAsk: (input: RetryAskProps) => Promise<DesktopReply>
  confirm: (input: ConfirmProps) => Promise<DesktopReply>
  decline: (input: DeclineProps) => DesktopReply
  /** Drops every held ask. */
  clear: () => void
}

/** A link main has expanded, waiting on the page's answer. */
type HeldAsk = { target: DownloadTarget; expansion: Expansion; at: number }

type ReadyExpansion = Extract<Expansion, { ok: true }>

type AskStatus = { ok: true; status: DownloadAskStatus } | { ok: false; message: string }

/**
 * Each file becomes `<mediaId>/video.<container>` or `<mediaId>/media.<container>` on disk, so both must be safe to name a file
 * by, and its size must be bytes a fetch can end at.
 */
const isStorable = ({ media }: ExpandedFile): boolean =>
  isMediaId(media.id) && isContainerName(media.container) && isFileSize(media.size)

type EntryOfProps = {
  file: ExpandedFile
  downloadId: string
  serverId: string
  autoDelete: boolean
  createdAt: number
}

const entryOf = ({
  file,
  downloadId,
  serverId,
  autoDelete,
  createdAt,
}: EntryOfProps): DownloadEntry => ({
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
  artwork: file.artwork,
  library: file.library,
  titleItemId: file.titleItemId,
  facts: factsOf(file.media),
  track: file.track,
})

/** The asks a download link raises: expanded, held for the page's answer, then queued or dropped. */
export const createDownloadAsks = (deps: DownloadAsksDeps): DownloadAsks => {
  const { store, serverId, now, change } = deps
  const asks = new Map<string, HeldAsk>()

  const dropExpired = (): void => {
    const oldest = now() - ASK_TTL_MS
    asks.forEach((held, askId) => {
      if (held.at < oldest) asks.delete(askId)
    })
  }

  const readyStatus = async (expansion: ReadyExpansion): Promise<DownloadAskStatus> => {
    const bytes = expansion.files.reduce((sum, file) => sum + file.media.size, 0)
    const { free } = await readSpace({
      fs: deps.space,
      dir: downloadsDirFor({ userData: deps.userData }),
    })
    // The files already on their way take their room first; the dialog names only the new ones.
    const owed = store
      .read()
      .entries.filter(isUnderWay)
      .reduce((sum, entry) => sum + Math.max(entry.size - bytesOf(entry), 0), 0)
    return {
      kind: DOWNLOAD_ASK_KINDS.ready,
      title: expansion.title,
      downloadKind: expansion.kind,
      files: expansion.files.length,
      bytes,
      free,
      canFit: fits({ bytes: bytes + owed, free }),
    }
  }

  /** The ask's status, or why there is no ask to hold. */
  const statusOf = async (expansion: Expansion): Promise<AskStatus> => {
    if (expansion.ok) {
      const unstorable = expansion.files.find((file) => !isStorable(file))
      if (unstorable !== undefined) {
        deps.warn(`${SERVER_NAME} named an unusable file for ${loggable(unstorable.label)}`)
        return { ok: false, message: EXPAND_MESSAGES.unreadable }
      }
      return { ok: true, status: await readyStatus(expansion) }
    }
    switch (expansion.reason) {
      case EXPAND_REASONS.locked:
        return { ok: true, status: { kind: DOWNLOAD_ASK_KINDS.locked } }
      case EXPAND_REASONS.gone:
      case EXPAND_REASONS.unreachable:
      case EXPAND_REASONS.tooMany:
      case EXPAND_REASONS.unreadable:
      // A page signed out is asked to sign in before this; an account the server refused hears why.
      case EXPAND_REASONS.account:
        return { ok: false, message: expansion.message }
      default: {
        const unreachable: never = expansion.reason
        return unreachable
      }
    }
  }

  type AskReplyProps = {
    askId: string
    status: DownloadAskStatus
  }

  const askReply = ({ askId, status }: AskReplyProps): DesktopReply => ({
    type: DESKTOP_REPLIES.downloadAsk,
    ask: {
      askId,
      serverId,
      serverName: SERVER_NAME,
      shouldAutoDelete: store.read().autoDeleteDefault,
      status,
    },
  })

  type HoldForAccountProps = {
    askId: string
    target: DownloadTarget
  }

  /** Holds the ask until the page signs in; a confirmation meanwhile is refused with why. */
  const holdForAccount = ({ askId, target }: HoldForAccountProps): DesktopReply => {
    const expansion: Expansion = {
      ok: false,
      reason: EXPAND_REASONS.account,
      message: EXPAND_MESSAGES.account,
    }
    asks.set(askId, { target, expansion, at: now() })
    return askReply({ askId, status: { kind: DOWNLOAD_ASK_KINDS.account } })
  }

  type ExpandUnderProps = {
    askId: string
    target: DownloadTarget
  }

  /** Expands `target` and holds it under `askId`; a refusal holds nothing, so a retry of it is gone. */
  const expandUnder = async ({ askId, target }: ExpandUnderProps): Promise<DesktopReply> => {
    // Main lists the files with the page's account, so a page signed out signs in first.
    if (!deps.isSignedIn()) return holdForAccount({ askId, target })
    const expansion = await expandTarget({
      calls: deps.calls,
      target,
      skip: (mediaId) => entryByMedia({ state: store.read(), serverId, mediaId }) !== null,
    })
    const outcome = await statusOf(expansion)
    if (!outcome.ok) {
      asks.delete(askId)
      return refused(outcome.message)
    }
    asks.set(askId, { target, expansion, at: now() })
    return askReply({ askId, status: outcome.status })
  }

  const ask: DownloadAsks['ask'] = async ({ target }) => {
    dropExpired()
    return expandUnder({ askId: deps.newId(), target })
  }

  const retryAsk: DownloadAsks['retryAsk'] = async ({ askId }) => {
    dropExpired()
    const held = asks.get(askId)
    if (held === undefined) return refused(DOWNLOAD_MESSAGES.askGone)
    return expandUnder({ askId, target: held.target })
  }

  const confirm: DownloadAsks['confirm'] = async ({ askId, autoDelete }) => {
    dropExpired()
    const held = asks.get(askId)
    if (held === undefined) return refused(DOWNLOAD_MESSAGES.askGone)
    const { expansion } = held
    // A locked ask, or one waiting on its account, waits for its retry; the page offers no Download until then.
    if (!expansion.ok) return refused(expansion.message)
    asks.delete(askId)
    // A file queued since the ask, by another ask or another link, is not queued twice.
    const fresh = expansion.files.filter(
      (file) => entryByMedia({ state: store.read(), serverId, mediaId: file.media.id }) === null,
    )
    const createdAt = now()
    const entries = fresh.map((file) =>
      entryOf({ file, downloadId: deps.newId(), serverId, autoDelete, createdAt }),
    )
    // The dialog's checkbox starts from the last choice made, so the choice becomes the default.
    change((state) => setAutoDeleteDefault({ state: queue({ state, entries }), autoDelete }))
    const [first] = fresh
    if (first !== undefined) {
      deps.send({
        type: DESKTOP_EVENTS.notice,
        message: DOWNLOAD_MESSAGES.queued({
          files: fresh.length,
          kind: expansion.kind,
          label: first.label,
        }),
      })
    }
    return deps.list()
  }

  const decline: DownloadAsks['decline'] = ({ askId }) => {
    asks.delete(askId)
    return DONE
  }

  return { ask, retryAsk, confirm, decline, clear: () => asks.clear() }
}
