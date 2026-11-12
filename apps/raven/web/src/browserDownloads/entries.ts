import {
  DOWNLOAD_STATUS_KINDS,
  type DownloadStatus,
  type DownloadView,
  type Infer,
  isBoolean,
  isContainerName,
  isDownloadArtwork,
  isDownloadFacts,
  isDownloadGroup,
  isDownloadLibrary,
  isDownloadStatus,
  isMediaId,
  isNumber,
  isOpaqueId,
  isRecord,
  isString,
  isSubtitleTrack,
  listOf,
  matching,
  nullable,
  object,
  oneOf,
} from '@raven/core'
import type { DiskPath } from '@/browserDownloads/disk'
import { DOWNLOAD_WAYS } from '@/browserDownloads/ways'

/** An account's id becomes a folder's name, so only what a Supabase id or `local` holds passes. */
export const isAccountId = matching(/^[A-Za-z0-9_-]{1,64}$/u)

/** The account every viewer shares on a server with accounts off, as the server names it. */
export const LOCAL_ACCOUNT = 'local'

const PICTURE_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
} as const

type PictureType = keyof typeof PICTURE_TYPES

const isPictureType = (value: string): value is PictureType => Object.hasOwn(PICTURE_TYPES, value)

/** The extension a picture of a response's content type is saved under; null for any other type. */
export const pictureExtensionOf = (contentType: string): string | null => {
  const type = contentType.split(';')[0]?.trim().toLowerCase() ?? ''
  return isPictureType(type) ? PICTURE_TYPES[type] : null
}

/** A picture on disk: the opaque id the page shows it by, and its file's name in its title's folder. */
const isSavedPicture = object({
  id: isOpaqueId,
  name: matching(/^[0-9a-f-]{36}\.(?:jpg|png|webp|avif)$/u),
})

export type SavedPicture = Infer<typeof isSavedPicture>

/** A text subtitle saved as WebVTT beside its video, with the track it is as the server named it. */
const isSavedSubtitle = object({ track: isSubtitleTrack, name: matching(/^\d{1,3}\.vtt$/u) })

export type SavedSubtitle = Infer<typeof isSavedSubtitle>

/** Kept as the server sent it and checked again by whoever reads it, so a contract that grows drops no download. */
const isKept = (value: unknown): value is unknown => value !== undefined

/*
 * One video the browser keeps, with all the Downloads page and the player show of it, so both
 * work with no server. `size` is the original's until a copy is ready, then the copy's.
 */
const isBrowserEntry = object({
  downloadId: isOpaqueId,
  accountId: isAccountId,
  mediaId: isMediaId,
  label: isString,
  group: isDownloadGroup,
  way: oneOf(Object.values(DOWNLOAD_WAYS)),
  extension: isContainerName,
  size: isNumber,
  status: isDownloadStatus,
  createdAt: isNumber,
  artwork: isDownloadArtwork,
  library: nullable(isDownloadLibrary),
  /** The item whose poster and title art the video wears: its show's for an episode. */
  titleItemId: nullable(isNumber),
  pictures: object({
    art: nullable(isSavedPicture),
    logo: nullable(isSavedPicture),
    /** Whether every picture the title has is saved; false asks again at the next fill. */
    isComplete: isBoolean,
  }),
  subtitles: listOf(isSavedSubtitle),
  /** Whether the subtitles were asked for and saved, so a finished download asks no more. */
  hasSubtitles: isBoolean,
  facts: isDownloadFacts,
  /** The `MediaItem` and its `MediaTracks`, as confirmed; null tracks until they are read. */
  media: isKept,
  tracks: nullable(isKept),
  /** Where the viewer left it, in seconds, and its length once the player learned it. */
  position: isNumber,
  duration: nullable(isNumber),
})

export type BrowserEntry = Infer<typeof isBrowserEntry>

const INDEX_VERSION = 1

const DOWNLOADS_DIR = 'downloads'

const INDEX_FILE = 'index.json'

const SUBTITLES_DIR = 'subtitles'

const PICTURES_DIR = 'pictures'

/** The one file that lists every download of every account on this browser. */
export const INDEX_PATH = [DOWNLOADS_DIR, INDEX_FILE] as const satisfies DiskPath

type EntryPlace = Pick<BrowserEntry, 'accountId' | 'downloadId'>

export const folderOf = ({ accountId, downloadId }: EntryPlace): DiskPath => [
  DOWNLOADS_DIR,
  accountId,
  downloadId,
]

type MediaPlace = Pick<BrowserEntry, keyof EntryPlace | 'extension'>

export const mediaPathOf = (entry: MediaPlace): DiskPath => [
  ...folderOf(entry),
  `media.${entry.extension}`,
]

type SubtitlePathOfProps = { entry: EntryPlace; name: string }

export const subtitlePathOf = ({ entry, name }: SubtitlePathOfProps): DiskPath => [
  ...folderOf(entry),
  SUBTITLES_DIR,
  name,
]

type PictureFolderOfProps = { accountId: string; itemId: number }

/** A title's pictures, kept once for every download of the account that shows them. */
export const pictureFolderOf = ({ accountId, itemId }: PictureFolderOfProps): DiskPath => [
  DOWNLOADS_DIR,
  accountId,
  PICTURES_DIR,
  `item-${itemId}`,
]

/** A download cut off by a closed tab was on its way: it reads back as waiting its turn. */
const settled = (entry: BrowserEntry): BrowserEntry =>
  entry.status.kind === DOWNLOAD_STATUS_KINDS.downloading
    ? { ...entry, status: { kind: DOWNLOAD_STATUS_KINDS.queued } }
    : entry

const parsed = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/**
 * The downloads an index file lists. A file that is not an index of this version lists none,
 * and an entry its guard does not pass is left out alone, so one bad entry hides no other.
 */
export const readIndex = (text: string): BrowserEntry[] => {
  const index = parsed(text)
  if (!isRecord(index) || index.version !== INDEX_VERSION || !Array.isArray(index.entries)) {
    return []
  }
  return index.entries.filter(isBrowserEntry).map(settled)
}

export const writeIndex = (entries: readonly BrowserEntry[]): string =>
  JSON.stringify({ version: INDEX_VERSION, entries })

type BytesOfProps = Pick<BrowserEntry, 'status' | 'size'>

/** The bytes of an entry on disk, as its status says. */
export const bytesOf = ({ status, size }: BytesOfProps): number => {
  switch (status.kind) {
    case DOWNLOAD_STATUS_KINDS.ready:
      return size
    case DOWNLOAD_STATUS_KINDS.queued:
      return 0
    case DOWNLOAD_STATUS_KINDS.downloading:
    case DOWNLOAD_STATUS_KINDS.paused:
    case DOWNLOAD_STATUS_KINDS.failed:
      return status.bytes
    default: {
      const unreachable: never = status
      return unreachable
    }
  }
}

/** Whether an entry waits its turn or is on its way: what a new ask leaves room for. */
export const isUnderWay = ({ kind }: DownloadStatus): boolean =>
  kind === DOWNLOAD_STATUS_KINDS.queued || kind === DOWNLOAD_STATUS_KINDS.downloading

/** The one server a browser downloads from, named as the protocol's views need: by an opaque id. */
export const BROWSER_SERVER = {
  id: '00000000-0000-4000-8000-000000000000',
  name: 'raven',
} as const

type WatchedOfProps = Pick<BrowserEntry, 'position' | 'duration'>

const watchedOf = ({ position, duration }: WatchedOfProps): number | null =>
  duration === null || duration <= 0 ? null : Math.min(position / duration, 1)

/** An entry as the Downloads page reads it: the protocol's view, which names no file or account. */
export const viewOf = (entry: BrowserEntry): DownloadView => ({
  downloadId: entry.downloadId,
  serverId: BROWSER_SERVER.id,
  label: entry.label,
  group: entry.group,
  serverName: BROWSER_SERVER.name,
  size: entry.size,
  status: entry.status,
  shouldAutoDelete: false,
  watched: watchedOf(entry),
  deletesAt: null,
  isLocked: false,
  artwork: entry.artwork,
  pictures: { art: entry.pictures.art?.id ?? null, logo: entry.pictures.logo?.id ?? null },
  library: entry.library,
  facts: entry.facts,
  createdAt: entry.createdAt,
  track: null,
})
