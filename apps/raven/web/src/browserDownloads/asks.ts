import {
  type CanPlay,
  DOWNLOAD_ASK_KINDS,
  DOWNLOAD_STATUS_KINDS,
  type DownloadAsk,
  type DownloadTarget,
  isContainerName,
} from '@raven/core'
import type { DownloadClock } from '@/browserDownloads/clock'
import { BROWSER_DOWNLOAD_COPY } from '@/browserDownloads/copy'
import type { DownloadDisk } from '@/browserDownloads/disk'
import { BROWSER_SERVER, type BrowserEntry, bytesOf, isUnderWay } from '@/browserDownloads/entries'
import {
  EXPAND_REASONS,
  type ExpandedFile,
  type Expansion,
  expandTarget,
} from '@/browserDownloads/expand'
import type { DownloadServer } from '@/browserDownloads/server'
import type { DownloadStore } from '@/browserDownloads/store'
import { COPY_EXTENSION, DOWNLOAD_WAYS, downloadWayOf, isKeepable } from '@/browserDownloads/ways'

/** How long an ask waits for the page's answer. */
const ASK_TTL_MS = 600_000

export type Answer<T> = { ok: true; value: T } | { ok: false; message: string }

type DownloadAsksDeps = {
  disk: DownloadDisk
  server: DownloadServer
  clock: DownloadClock
  canPlay: CanPlay
  newId: () => string
  store: DownloadStore
  /** The account's downloads as they stand now, the one on its way with the bytes it has. */
  shown: () => BrowserEntry[]
}

export type DownloadAsks = {
  /** Reads a title from the server and says what downloading it would take, for the page to confirm. */
  ask: (target: DownloadTarget) => Promise<Answer<DownloadAsk>>
  /** The downloads a confirmed ask queues, and the ask is spent; null for one no longer held. */
  confirm: (askId: string) => BrowserEntry[] | null
  decline: (askId: string) => void
  /** Lets go of every ask: the account they were made for left. */
  clear: () => void
}

type HeldAsk = { accountId: string; expansion: Extract<Expansion, { ok: true }>; at: number }

type EntryOfFileProps = { file: ExpandedFile; accountId: string; createdAt: number }

/**
 * What the page asks before a title downloads: the files it comes to, the room they take and the
 * room there is. An ask is held for the page's answer, and only for the account it was made for.
 */
export const createDownloadAsks = ({
  disk,
  server,
  clock,
  canPlay,
  newId,
  store,
  shown,
}: DownloadAsksDeps): DownloadAsks => {
  const held = new Map<string, HeldAsk>()

  const entryOfFile = ({ file, accountId, createdAt }: EntryOfFileProps): BrowserEntry => {
    const way = downloadWayOf({ media: file.media, canPlay })
    return {
      downloadId: newId(),
      accountId,
      mediaId: file.media.id,
      label: file.label,
      group: file.group,
      way,
      extension: way === DOWNLOAD_WAYS.file ? file.media.container : COPY_EXTENSION,
      size: file.media.size,
      status: { kind: DOWNLOAD_STATUS_KINDS.queued },
      createdAt,
      artwork: file.artwork,
      library: file.library,
      titleItemId: file.titleItemId,
      pictures: { art: null, logo: null, isComplete: false },
      subtitles: [],
      hasSubtitles: false,
      facts: file.facts,
      media: file.media,
      tracks: null,
      position: file.media.position,
      duration: file.media.duration,
    }
  }

  /** A copy is always an MP4; an original keeps its container, which names its file. */
  const isStorable = ({ media }: ExpandedFile): boolean =>
    downloadWayOf({ media, canPlay }) !== DOWNLOAD_WAYS.file || isContainerName(media.container)

  const hasMedia = (mediaId: number): boolean =>
    store.own().some((entry) => entry.mediaId === mediaId)

  const askOf = (status: DownloadAsk['status']): DownloadAsk => ({
    askId: newId(),
    serverId: BROWSER_SERVER.id,
    serverName: BROWSER_SERVER.name,
    shouldAutoDelete: false,
    status,
  })

  return {
    ask: async (target) => {
      const accountId = store.account()
      if (accountId === null) {
        return { ok: true, value: askOf({ kind: DOWNLOAD_ASK_KINDS.account }) }
      }
      const expansion = await expandTarget({ api: server.api, target, shouldSkip: hasMedia })
      if (!expansion.ok) {
        return expansion.reason === EXPAND_REASONS.locked
          ? { ok: true, value: askOf({ kind: DOWNLOAD_ASK_KINDS.locked }) }
          : { ok: false, message: expansion.message }
      }
      // A season or show leaves out the episodes this browser cannot keep; a title of nothing else is refused.
      const files = expansion.files.filter(({ media }) => isKeepable({ media, canPlay }))
      if (expansion.files.length > 0 && files.length === 0) {
        return { ok: false, message: BROWSER_DOWNLOAD_COPY.dolbyVision }
      }
      if (!files.every(isStorable)) {
        return { ok: false, message: BROWSER_DOWNLOAD_COPY.unreadable }
      }
      const bytes = files.reduce((sum, file) => sum + file.media.size, 0)
      const { usage, quota } = await disk.space()
      const free = Math.max(quota - usage, 0)
      // The files already on their way take their room first; the dialog names only the new ones.
      const owed = shown()
        .filter(({ status }) => isUnderWay(status))
        .reduce((sum, entry) => sum + Math.max(entry.size - bytesOf(entry), 0), 0)
      const ask = askOf({
        kind: DOWNLOAD_ASK_KINDS.ready,
        title: expansion.title,
        downloadKind: expansion.kind,
        files: files.length,
        bytes,
        free,
        canFit: bytes + owed <= free,
      })
      const now = clock.now()
      held.forEach((each, askId) => {
        if (now - each.at > ASK_TTL_MS) held.delete(askId)
      })
      held.set(ask.askId, { accountId, expansion: { ...expansion, files }, at: now })
      return { ok: true, value: ask }
    },
    confirm: (askId) => {
      const ask = held.get(askId)
      held.delete(askId)
      if (ask === undefined || ask.accountId !== store.account()) return null
      const { accountId } = ask
      const createdAt = clock.now()
      // A file queued since the ask, by another ask, is not queued twice.
      return ask.expansion.files
        .filter(({ media }) => !hasMedia(media.id))
        .map((file) => entryOfFile({ file, accountId, createdAt }))
    },
    decline: (askId) => {
      held.delete(askId)
    },
    clear: () => held.clear(),
  }
}
