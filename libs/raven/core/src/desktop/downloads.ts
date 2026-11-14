import { isTrack } from '@/contract'
import { isOpaqueId } from '@/desktop/opaqueId'
import {
  type Infer,
  isBoolean,
  isNumber,
  isString,
  matching,
  nullable,
  object,
  oneOf,
  tagged,
  union,
} from '@/schema'

/*
 * What Raven keeps of a download, as main stores it and the page shows it: its kind and group,
 * its status, its pictures, library and facts, and the dialog that asks before one starts.
 */

/** A container becomes `video.<container>` or `media.<container>` on disk, so only a short lowercase name passes. */
export const isContainerName = matching(/^[a-z0-9]{1,8}$/u)

/** A sidecar's track id becomes `subtitles/<trackId>.vtt` on disk, so only the server's `external-<n>` passes. */
export const isSidecarTrackId = matching(/^external-\d+$/u)

export const DOWNLOAD_KINDS = {
  movie: 'movie',
  episode: 'episode',
  season: 'season',
  show: 'show',
  saga: 'saga',
  album: 'album',
  playlist: 'playlist',
} as const

export const isDownloadKind = oneOf(Object.values(DOWNLOAD_KINDS))

export type DownloadKind = Infer<typeof isDownloadKind>

/** What a download group's `key` starts with, before its ids: `show:4`, `saga:2:1241`. */
export const DOWNLOAD_GROUP_PREFIXES = {
  show: 'show',
  item: 'item',
  movie: 'movie',
  saga: 'saga',
  album: 'album',
  playlist: 'playlist',
} as const

export type DownloadGroupPrefix =
  (typeof DOWNLOAD_GROUP_PREFIXES)[keyof typeof DOWNLOAD_GROUP_PREFIXES]

const GROUP_KEY_SEPARATOR = ':'

type DownloadGroupKeyProps = {
  prefix: DownloadGroupPrefix
  /** The ids that name the group on its server: one for most, a library's and TMDB's for a saga. */
  ids: readonly [number | string, ...(number | string)[]]
}

/** A download group's key on its server: `show:4`, `saga:2:1241`. */
export const downloadGroupKey = ({ prefix, ids }: DownloadGroupKeyProps): string =>
  [prefix, ...ids].join(GROUP_KEY_SEPARATOR)

const GROUP_FIELDS = { key: isString, title: isString, order: isNumber }

/** The album cover a music group shows: an album's own, or a playlist's first track's album's. */
const isDownloadCover = object({ albumId: isNumber, coverVersion: nullable(isString) })

export type DownloadCover = Infer<typeof isDownloadCover>

/**
 * An album's or a playlist's group, which carries the cover Downloads heads it with, and the
 * album's or playlist's own id, which a queue played from it names.
 */
export const isMusicGroup = object({
  kind: oneOf([DOWNLOAD_KINDS.album, DOWNLOAD_KINDS.playlist]),
  ...GROUP_FIELDS,
  cover: nullable(isDownloadCover),
  sourceId: isNumber,
})

/**
 * Where a download sits in its group. `key` names the group on its server: `show:<itemId>` for an
 * episode, season or show, `saga:<libraryId>:<tmdbId>`, `movie:<mediaId>`, `album:<albumId>` or
 * `playlist:<playlistId>`. `order` is the play order, a season times 10000 plus the episode, a
 * saga's index, or a track's place on its album or playlist. A music group carries its `cover`,
 * null for a playlist with no tracks; a video group has none, so a `downloads.json` written before
 * music reads as it is.
 */
export const isDownloadGroup = union(
  object({
    kind: oneOf([
      DOWNLOAD_KINDS.movie,
      DOWNLOAD_KINDS.episode,
      DOWNLOAD_KINDS.season,
      DOWNLOAD_KINDS.show,
      DOWNLOAD_KINDS.saga,
    ]),
    ...GROUP_FIELDS,
  }),
  isMusicGroup,
)

export type DownloadGroup = Infer<typeof isDownloadGroup>

export const DOWNLOAD_STATUS_KINDS = {
  queued: 'queued',
  downloading: 'downloading',
  paused: 'paused',
  failed: 'failed',
  ready: 'ready',
} as const

export const isDownloadStatus = tagged({
  tag: 'kind',
  variants: {
    [DOWNLOAD_STATUS_KINDS.queued]: {},
    [DOWNLOAD_STATUS_KINDS.downloading]: { bytes: isNumber },
    [DOWNLOAD_STATUS_KINDS.paused]: {
      bytes: isNumber,
      message: nullable(isString),
    },
    [DOWNLOAD_STATUS_KINDS.failed]: { bytes: isNumber, message: isString },
    [DOWNLOAD_STATUS_KINDS.ready]: {},
  },
})

export type DownloadStatus = Infer<typeof isDownloadStatus>

export const DOWNLOAD_ARTWORK_KINDS = { poster: 'poster', cover: 'cover', none: 'none' } as const

/**
 * The picture a download shows, as the ids and version the server's capability address names:
 * a title's poster, an album's cover for audio, or nothing. No origin or path, so the page builds
 * the address itself and a title the server has no picture for shows its initial.
 */
export const isDownloadArtwork = tagged({
  tag: 'kind',
  variants: {
    [DOWNLOAD_ARTWORK_KINDS.poster]: {
      itemId: isNumber,
      version: isString,
    },
    [DOWNLOAD_ARTWORK_KINDS.cover]: {
      albumId: isNumber,
      version: isString,
    },
    [DOWNLOAD_ARTWORK_KINDS.none]: {},
  },
})

export type DownloadArtwork = Infer<typeof isDownloadArtwork>

/**
 * The pictures a download keeps on disk, each by the opaque id its host serves it under
 * (`pictureUrlFor`): `art` is the title's poster, a show's for an episode, or an album's cover for
 * a track, and `logo` the title's art. Null for one not saved yet, or one the title has none of,
 * where `artwork` is what the page falls back to.
 */
export const isDownloadPictures = object({
  art: nullable(isOpaqueId),
  logo: nullable(isOpaqueId),
})

export type DownloadPictures = Infer<typeof isDownloadPictures>

/**
 * The library a download came from, as it stood when the download was confirmed, so Downloads
 * groups by it and hides a private one's (one the server keeps behind its PIN) with no server.
 */
export const isDownloadLibrary = object({ id: isNumber, name: isString, isPrivate: isBoolean })

export type DownloadLibrary = Infer<typeof isDownloadLibrary>

/**
 * What a library sorts its files on that a download's own fields do not hold, kept from the file
 * when it was confirmed so the Watch grid can sort on every field a library can. `pixels` is
 * width times height, which is how resolution ranks; `score` is out of 10.
 */
export const isDownloadFacts = object({
  year: nullable(isNumber),
  score: nullable(isNumber),
  bitrate: nullable(isNumber),
  pixels: nullable(isNumber),
  addedAt: isString,
  changedAt: isString,
})

export type DownloadFacts = Infer<typeof isDownloadFacts>

export const DOWNLOAD_ASK_KINDS = {
  ready: 'ready',
  locked: 'locked',
  account: 'account',
} as const

/**
 * What the download dialog shows: the files to fetch, the PIN to enter in the web before main can
 * list them (main's calls carry the page's unlock), or that the page must sign in first, since
 * main has no account to ask with.
 */
export const isDownloadAskStatus = tagged({
  tag: 'kind',
  variants: {
    [DOWNLOAD_ASK_KINDS.ready]: {
      title: isString,
      downloadKind: isDownloadKind,
      files: isNumber,
      bytes: isNumber,
      free: isNumber,
      canFit: isBoolean,
    },
    [DOWNLOAD_ASK_KINDS.locked]: {},
    [DOWNLOAD_ASK_KINDS.account]: {},
  },
})

export type DownloadAskStatus = Infer<typeof isDownloadAskStatus>

/** A download link main has expanded and holds under `askId` until the page answers it. */
export const isDownloadAsk = object({
  askId: isOpaqueId,
  serverId: isOpaqueId,
  serverName: isString,
  shouldAutoDelete: isBoolean,
  status: isDownloadAskStatus,
})

export type DownloadAsk = Infer<typeof isDownloadAsk>

/**
 * A download as the page shows it: it and its server by opaque ids, with no origin or path. A
 * track's download carries its `Track`, so Downloads queues it with no server; null for a video,
 * and for a track of a server Raven no longer holds, which the music engine cannot play.
 */
export const isDownloadView = object({
  downloadId: isOpaqueId,
  serverId: isOpaqueId,
  label: isString,
  group: isDownloadGroup,
  serverName: isString,
  size: isNumber,
  status: isDownloadStatus,
  shouldAutoDelete: isBoolean,
  watched: nullable(isNumber),
  deletesAt: nullable(isNumber),
  isLocked: isBoolean,
  artwork: isDownloadArtwork,
  pictures: isDownloadPictures,
  /** Null for a download confirmed before libraries were kept, until main has asked the server. */
  library: nullable(isDownloadLibrary),
  facts: isDownloadFacts,
  /** When the download was confirmed, in milliseconds since the epoch. */
  createdAt: isNumber,
  track: nullable(isTrack),
})

export type DownloadView = Infer<typeof isDownloadView>

export const isSpaceView = object({ free: isNumber, total: isNumber, used: isNumber })

export type SpaceView = Infer<typeof isSpaceView>
