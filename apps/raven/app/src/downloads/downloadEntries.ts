import {
  AUDIO_BITRATES,
  type Infer,
  type MediaItem,
  type Track,
  isAudioBitrate,
  isBoolean,
  isLibraryIconName,
  isMediaItem,
  isMediaTracks,
  isNumber,
  isRecord,
  isString,
  isTrack,
  nullable,
  object,
  oneOf,
  optional,
  union,
} from '@raven/core'

import { trackWayOf } from '@/downloads/downloadWays'

/** The folder under the app's documents every download lives in, one folder per server inside it. */
export const DOWNLOADS_FOLDER = 'downloads'

/** The picture a download wears in Downloads, saved beside its file so it shows offline. */
export const ART_FILE = 'art.jpg'

/** The show's or movie's title art, saved beside its file so Downloads names it offline. */
export const LOGO_FILE = 'logo.png'

const PATH_SEPARATOR = '/'

const KEY_SEPARATOR = ':'

/** What a download is: a video the player opens, or a track the music queue plays. */
export const DOWNLOAD_KINDS = { video: 'video', track: 'track' } as const

/**
 * Which bytes a download fetches: the original file, the server's MP4 copy of a video this
 * device cannot open as it is, or the server's AAC transcode of a track it cannot decode.
 */
export const DOWNLOAD_WAYS = { file: 'file', copy: 'copy', transcode: 'transcode' } as const

/** Where one download stands. */
export const DOWNLOAD_STATES = {
  queued: 'queued',
  preparing: 'preparing',
  downloading: 'downloading',
  done: 'done',
  failed: 'failed',
} as const

/** What a download was asked for from, which Downloads groups it under. */
export const GROUP_KINDS = {
  movie: 'movie',
  show: 'show',
  video: 'video',
  album: 'album',
  playlist: 'playlist',
} as const

/** The library a download was asked from, as it stood then, so Downloads groups and hides by it offline. */
const isDownloadLibrary = object({
  id: isNumber,
  name: isString,
  /** The library's icon, worked out when the download was asked, so a heading draws it offline. */
  icon: isLibraryIconName,
  /** Whether the library was behind the PIN; refreshed from the server's list while it answers. */
  isLocked: isBoolean,
})

export type DownloadLibrary = Infer<typeof isDownloadLibrary>

const isDownloadGroup = object({
  kind: oneOf(Object.values(GROUP_KINDS)),
  /** The movie's, show's, album's or playlist's id; a lone video's media id. */
  id: isNumber,
  title: isString,
  /** A show's season, which groups its episodes apart from the others'; null for anything else. */
  season: nullable(isNumber),
  /** The library it was asked from; null when the page did not know, and on a download from before. */
  library: optional(nullable(isDownloadLibrary)),
})

export type DownloadGroup = Infer<typeof isDownloadGroup>

/** A group as a page or a card asks for it; the store files the library on it. */
export type AskedGroup = Omit<DownloadGroup, 'library'>

const isDownloadStatus = union(
  /** Waiting its turn; `preparing` is the server's progress on its MP4 copy meanwhile, 1 once ready, null or missing for none yet. */
  object({ state: oneOf([DOWNLOAD_STATES.queued]), preparing: optional(nullable(isNumber)) }),
  /** The server is making its MP4 copy: `progress` from 0 to 1. */
  object({ state: oneOf([DOWNLOAD_STATES.preparing]), progress: isNumber }),
  object({ state: oneOf([DOWNLOAD_STATES.downloading]) }),
  object({ state: oneOf([DOWNLOAD_STATES.done]), bytes: isNumber }),
  object({ state: oneOf([DOWNLOAD_STATES.failed]), message: isString }),
)

export type DownloadStatus = Infer<typeof isDownloadStatus>

type StatusOf<State extends DownloadStatus['state']> = Extract<DownloadStatus, { state: State }>

/** Where a download stands before it is settled: waiting its turn, being made on the server, or coming in. */
export type UnderwayStatus = StatusOf<
  | typeof DOWNLOAD_STATES.queued
  | typeof DOWNLOAD_STATES.preparing
  | typeof DOWNLOAD_STATES.downloading
>

/** How a download ends: whole on the disk, or failed with why. */
export type SettledStatus = StatusOf<typeof DOWNLOAD_STATES.done | typeof DOWNLOAD_STATES.failed>

/** What every download keeps, whatever it is. */
const ENTRY_SHAPE = {
  serverId: isString,
  mediaId: isNumber,
  /** Its name in Downloads: the title, an episode's or a track's. */
  title: isString,
  /** The line under it: an episode's code, a track's artists. */
  line: isString,
  group: isDownloadGroup,
  /** Where it sits in its group: an episode's or a track's number. */
  order: isNumber,
  way: oneOf(Object.values(DOWNLOAD_WAYS)),
  /** Under the app's documents, since the documents folder's own address moves on an update. */
  path: isString,
  /** The capability address of its poster or cover, fetched once its file is in; null for none. */
  artUri: nullable(isString),
  /** The picture saved beside the file; null until it is, or when it has none. */
  artPath: nullable(isString),
  /** The capability address of its show's or movie's title art; null for none, missing on a download from before. */
  logoUri: optional(nullable(isString)),
  /** The title art saved beside the file; null until it is, or when there is none. */
  logoPath: optional(nullable(isString)),
  status: isDownloadStatus,
  /** When it was asked for, in milliseconds. */
  addedAt: isNumber,
  /** Which time it was queued: a fetch lands only on the entry it was started for. */
  stamp: isNumber,
  /** Its place in the queue, lowest first; missing on a download saved before the queue had an order. */
  place: optional(isNumber),
}

const isVideoEntry = object({
  ...ENTRY_SHAPE,
  kind: oneOf([DOWNLOAD_KINDS.video]),
  /** The video as the server listed it, so it plays with the server out of reach. */
  media: isMediaItem,
  /** The original file's tracks, for the player's pickers; null for the server's copy, whose tracks are its own. */
  tracks: nullable(isMediaTracks),
})

const isTrackEntry = object({
  ...ENTRY_SHAPE,
  kind: oneOf([DOWNLOAD_KINDS.track]),
  track: isTrack,
  kbps: nullable(isAudioBitrate),
})

const isDownloadEntry = union(isVideoEntry, isTrackEntry)

/** An entry as it was saved, its `place` possibly missing; `entriesOf` gives every one a place. */
type SavedEntry = Infer<typeof isDownloadEntry>

type Placed<T> = Omit<T, 'place'> & { place: number }

export type VideoEntry = Placed<Infer<typeof isVideoEntry>>

type TrackEntry = Placed<Infer<typeof isTrackEntry>>

export type DownloadEntry = VideoEntry | TrackEntry

type WithStatus<Status extends DownloadStatus> = DownloadEntry & { status: Status }

/** A download waiting its turn, being made on the server, or coming in. */
export type UnderwayEntry = WithStatus<UnderwayStatus>

type DoneEntry = WithStatus<StatusOf<typeof DOWNLOAD_STATES.done>>

type FailedEntry = WithStatus<StatusOf<typeof DOWNLOAD_STATES.failed>>

/** What a run writes back onto its entry as it goes: its status, its pictures and a video's tracks. */
export type EntryChange = Partial<
  Pick<VideoEntry, 'status' | 'artPath' | 'logoPath' | 'logoUri' | 'tracks'>
>

/** A change to write onto `entry`, which lands only while `entry` is still the current queuing. */
export type EntryUpdate = { entry: DownloadEntry; change: EntryChange }

/** A failed download's status, saying why. */
export const failedWith = (message: string): SettledStatus => ({
  state: DOWNLOAD_STATES.failed,
  message,
})

export const isQueued = (entry: DownloadEntry): boolean =>
  entry.status.state === DOWNLOAD_STATES.queued

/** The library a download is filed under; null when none was recorded. */
export const libraryOfEntry = (entry: DownloadEntry): DownloadLibrary | null =>
  entry.group.library ?? null

type DownloadKeyOfProps = { serverId: string; mediaId: number }

/** A download's key: its server and its media id, so one server's id never stands for another's. */
export const downloadKeyOf = ({ serverId, mediaId }: DownloadKeyOfProps): string =>
  [serverId, mediaId].join(KEY_SEPARATOR)

export const keyOfEntry = (entry: DownloadEntry): string =>
  downloadKeyOf({ serverId: entry.serverId, mediaId: entry.mediaId })

type GroupKeyOfProps = { serverId: string; group: DownloadGroup }

/** A group's key: its server, its kind, its id and, for a season, its number. */
export const groupKeyOf = ({ serverId, group }: GroupKeyOfProps): string =>
  [serverId, group.kind, group.id, group.season ?? ''].join(KEY_SEPARATOR)

export const groupKeyOfEntry = (entry: DownloadEntry): string =>
  groupKeyOf({ serverId: entry.serverId, group: entry.group })

type FolderOfProps = { serverId: string; mediaId: number }

/** The folder a download's files sit in, `downloads/<serverId>/<mediaId>`. */
export const folderOf = ({ serverId, mediaId }: FolderOfProps): string =>
  [DOWNLOADS_FOLDER, serverId, String(mediaId)].join(PATH_SEPARATOR)

export const folderOfEntry = (entry: DownloadEntry): string =>
  folderOf({ serverId: entry.serverId, mediaId: entry.mediaId })

type InFolderProps = { folder: string; file: string }

export const inFolder = ({ folder, file }: InFolderProps): string =>
  [folder, file].join(PATH_SEPARATOR)

/** Only letters and digits name a file, so nothing a server says can climb out of its folder. */
const SAFE_EXTENSION = /^[a-z0-9]{1,8}$/

const FALLBACK_EXTENSION = 'bin'

/** The MP4 the server's copy of a video is. */
const COPY_EXTENSION = 'mp4'

/** The AAC a track's transcode is. */
const TRANSCODE_EXTENSION = 'm4a'

type FileNameOfProps = { way: DownloadEntry['way']; container: string }

/** The file's name: `media.<container>` for the original, `media.mp4` or `media.m4a` for the server's. */
const fileNameOf = ({ way, container }: FileNameOfProps): string => {
  const extensions = {
    [DOWNLOAD_WAYS.file]: SAFE_EXTENSION.test(container) ? container : FALLBACK_EXTENSION,
    [DOWNLOAD_WAYS.copy]: COPY_EXTENSION,
    [DOWNLOAD_WAYS.transcode]: TRANSCODE_EXTENSION,
  } as const satisfies Record<DownloadEntry['way'], string>
  return `media.${extensions[way]}`
}

export const isDone = (entry: DownloadEntry): entry is DoneEntry =>
  entry.status.state === DOWNLOAD_STATES.done

export const isFailed = (entry: DownloadEntry): entry is FailedEntry =>
  entry.status.state === DOWNLOAD_STATES.failed

/** Waiting its turn, being made on the server, or coming in. */
export const isUnderway = (entry: DownloadEntry): entry is UnderwayEntry =>
  !isDone(entry) && !isFailed(entry)

/** The bytes a finished download takes; none for the rest. */
export const bytesOf = ({ status }: DownloadEntry): number =>
  status.state === DOWNLOAD_STATES.done ? status.bytes : 0

/** The bytes the finished downloads take, together. */
export const usedBytesOf = (entries: readonly DownloadEntry[]): number =>
  entries.reduce((sum, entry) => sum + bytesOf(entry), 0)

/** A fresh download's status, before the server has been asked anything. */
export const QUEUED: DownloadStatus = { state: DOWNLOAD_STATES.queued, preparing: null }

/** The order the queue ran in before it had places: by when each was queued, then by place in its group. */
const byStampThenOrder = (a: SavedEntry, b: SavedEntry): number =>
  a.stamp - b.stamp || a.order - b.order

/**
 * Gives every saved entry a place: those saved with one keep it, and those from before are
 * ranked after them in the order the queue ran then, so an upgrade changes nothing.
 */
const placed = (entries: readonly SavedEntry[]): DownloadEntry[] => {
  const kept = entries.flatMap((entry): DownloadEntry[] =>
    entry.place === undefined ? [] : [{ ...entry, place: entry.place }],
  )
  const highest = kept.reduce((top, entry) => Math.max(top, entry.place), -1)
  const unplaced = entries
    .filter((entry) => entry.place === undefined)
    .toSorted(byStampThenOrder)
    .map((entry, index): DownloadEntry => ({ ...entry, place: highest + 1 + index }))
  return [...kept, ...unplaced]
}

/**
 * What was read back, each entry kept only where it is one. A download the app was stopped in
 * the middle of goes back in the queue, to start again from nothing.
 */
export const entriesOf = (saved: unknown): Record<string, DownloadEntry> => {
  const kept = isRecord(saved) ? saved : {}
  const entries = isRecord(kept.entries) ? Object.values(kept.entries) : []
  return Object.fromEntries(
    placed(entries.filter(isDownloadEntry)).map((entry) => [
      keyOfEntry(entry),
      isUnderway(entry) ? { ...entry, status: QUEUED } : entry,
    ]),
  )
}

/** The place after every one held, for what is queued next. */
export const nextPlaceOf = (entries: readonly DownloadEntry[]): number =>
  entries.reduce((top, entry) => Math.max(top, entry.place), -1) + 1

/** A video to download: its file, or the server's MP4 copy. */
export type VideoRequest = {
  kind: typeof DOWNLOAD_KINDS.video
  media: MediaItem
  way: typeof DOWNLOAD_WAYS.file | typeof DOWNLOAD_WAYS.copy
  title: string
  line: string
  order: number
}

/** A track to download, as its file or, where AVPlayer cannot decode it, as AAC. */
export type TrackRequest = {
  kind: typeof DOWNLOAD_KINDS.track
  track: Track
  title: string
  line: string
  order: number
}

export type DownloadRequest = VideoRequest | TrackRequest

/** The media a request is for, which keys its download. */
export const mediaIdOfRequest = (item: DownloadRequest): number =>
  item.kind === DOWNLOAD_KINDS.video ? item.media.id : item.track.id

type EntryOfProps = {
  serverId: string
  group: DownloadGroup
  artUri: string | null
  logoUri: string | null
  item: DownloadRequest
  addedAt: number
  stamp: number
  place: number
}

/** A fresh download of `item`, queued at `place`. */
export const entryOf = ({
  serverId,
  group,
  artUri,
  logoUri,
  item,
  addedAt,
  stamp,
  place,
}: EntryOfProps): DownloadEntry => {
  const mediaId = mediaIdOfRequest(item)
  const common = {
    serverId,
    mediaId,
    title: item.title,
    line: item.line,
    group,
    order: item.order,
    artUri,
    artPath: null,
    logoUri,
    logoPath: null,
    status: QUEUED,
    addedAt,
    stamp,
    place,
  }
  const folder = folderOf({ serverId, mediaId })
  switch (item.kind) {
    case DOWNLOAD_KINDS.video:
      return {
        ...common,
        kind: DOWNLOAD_KINDS.video,
        way: item.way,
        path: inFolder({
          folder,
          file: fileNameOf({ way: item.way, container: item.media.container }),
        }),
        media: item.media,
        tracks: null,
      }
    case DOWNLOAD_KINDS.track: {
      const way = trackWayOf(item.track)
      return {
        ...common,
        kind: DOWNLOAD_KINDS.track,
        way,
        path: inFolder({ folder, file: fileNameOf({ way, container: item.track.container }) }),
        track: item.track,
        kbps: way === DOWNLOAD_WAYS.transcode ? AUDIO_BITRATES.standard : null,
      }
    }
    default: {
      const unknown: never = item
      return unknown
    }
  }
}
