import { HTTP_METHODS, isSeconds, isTrack, isTrackIndex } from '@/contract'
import { watchPageOf } from '@/itemLinks'
import { isMediaId } from '@/contract/ids'
import { isDownloadTarget, PLAY_LINK_MAX_NEXT } from '@/playLink'
import { isOutputSettings, isPlayerSource } from '@/player'
import { fromQueryString, toQueryString } from '@/query'
import {
  type Infer,
  isBoolean,
  isNumber,
  isString,
  listOf,
  matching,
  nullable,
  object,
  oneOf,
  tagged,
  union,
  literal,
} from '@/schema'

export const FILE_SCHEME = 'raven-file'
/** The preload's hand-overs: the video player's port, and the music engine's. */
export const WINDOW_MESSAGE_TYPES = {
  playerPort: 'raven:player-port',
  audioPort: 'raven:audio-port',
} as const
/** Main's words once mpv has gone. They ride with reason `engine`, which is what the page reads. */
export const ENGINE_STOPPED = "Raven's video engine stopped. Open the video again."

/*
 * A standard scheme lowercases its host, so an id must already be lowercase to
 * survive a round trip through `raven-file://<id>`.
 */
const OPAQUE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** What `crypto.randomUUID()` returns: the only handle the page ever holds for a file. */
export const isOpaqueId = matching(OPAQUE_ID)

export const fileUrlFor = (fileId: string): string => `${FILE_SCHEME}://${fileId}`

/** The scheme a download's saved pictures are read under: `raven-picture://<picture id>`. */
export const PICTURE_SCHEME = 'raven-picture'

/** Where the page reads a saved picture from: its opaque id under `PICTURE_SCHEME`, never a path. */
export const pictureUrlFor = (pictureId: string): string => `${PICTURE_SCHEME}://${pictureId}`

export const isPlayTarget = object({ fileId: isOpaqueId, queue: listOf(isOpaqueId) })

export type PlayTarget = Infer<typeof isPlayTarget>

/** The longest path main asks the page to show. */
const MAX_PAGE_PATH = 2048

/**
 * A path on the page's own origin, as the web's router reads it: one leading slash, never two,
 * and no backslash, whitespace or control character, so it can never name another origin.
 */
export const isPagePath = (value: unknown): value is string =>
  isString(value) && value.length <= MAX_PAGE_PATH && /^\/(?![/\\])[^\\\s\p{Cc}]*$/u.test(value)

/** The query a watch path carries for Raven: where to start, and the titles after it. */
export const WATCH_PARAMS = { at: 'at', next: 'next' } as const

/** Where to start and what plays after, as a watch path's query carries them. */
export type WatchQuery = { at: number; next: number[] }

type WatchPathForProps = { mediaId: number } & WatchQuery

/**
 * The web's watch page for a title, with where to start (whole seconds, left out at 0) and the
 * titles after it (left out when there are none).
 */
export const watchPathFor = ({ mediaId, at, next }: WatchPathForProps): string => {
  if (!isMediaId(mediaId)) throw new RangeError(`${mediaId} is not a media id`)
  const start = Number.isFinite(at) ? Math.max(0, Math.floor(at)) : 0
  const queue = next.filter(isMediaId).slice(0, PLAY_LINK_MAX_NEXT)
  const query = {
    ...(start > 0 && { [WATCH_PARAMS.at]: String(start) }),
    ...(queue.length > 0 && { [WATCH_PARAMS.next]: queue.join(',') }),
  }
  const search = toQueryString(query)
  const page = watchPageOf(mediaId)
  return search === '' ? page : `${page}?${search}`
}

const WHOLE_NUMBER = /^\d{1,15}$/u

/** What a watch path's query asks for; a part it cannot read is left at its default. */
export const readWatchQuery = (search: string): WatchQuery => {
  const params = fromQueryString(search)
  const at = params[WATCH_PARAMS.at] ?? ''
  const ids = (params[WATCH_PARAMS.next] ?? '').split(',').filter((part) => part !== '')
  const next = ids.map(Number)
  const isQueue =
    next.length <= PLAY_LINK_MAX_NEXT &&
    ids.every((part, index) => isMediaId(next[index]) && String(next[index]) === part)
  return { at: WHOLE_NUMBER.test(at) ? Number(at) : 0, next: isQueue ? next : [] }
}

/** The methods a server call may use; the app's own protocols also answer HEAD. */
export const SERVER_METHODS = {
  get: HTTP_METHODS.get,
  put: HTTP_METHODS.put,
  post: HTTP_METHODS.post,
} as const

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

/** The longest account id main takes from the page. */
export const MAX_SECRET = 256

/** The longest access token main takes from the page: a Supabase JWT is a few kilobytes at most. */
export const MAX_ACCESS_TOKEN = 16_384

const isSecretText = (value: unknown): value is string =>
  isString(value) && value.length <= MAX_SECRET

/**
 * The page's Supabase session as main uses it: the access token it sends as the Bearer, and the
 * account it names. Main keeps it in memory only and checks that the token names that account.
 */
export const isPageSession = object({
  accessToken: (value: unknown): value is string =>
    isString(value) && value.length > 0 && value.length <= MAX_ACCESS_TOKEN,
  userId: (value: unknown): value is string => isSecretText(value) && value.length > 0,
})

export type PageSession = Infer<typeof isPageSession>

/** The titles that play after one, at most as many as a play link carries. */
const isUpNext = (value: unknown): value is number[] =>
  listOf(isMediaId)(value) && value.length <= PLAY_LINK_MAX_NEXT

export const isTrackChoice = object({ audio: nullable(isNumber), subtitle: nullable(isString) })

export const isLocalFile = object({
  fileId: isOpaqueId,
  label: isString,
  /** The folder the file is in, or for a download "Downloaded from <server>". */
  folder: isString,
  /** A download's `folder` says where it came from, so the player's header names it. */
  isDownload: isBoolean,
  /** A download's media on the server, whose art the player's header draws; null for any other file. */
  mediaId: nullable(isMediaId),
  /** A download's saved title art and the name it spells out, for the player's header; null with none. */
  logo: nullable(object({ pictureId: isOpaqueId, name: isString })),
  resumeAt: isNumber,
  next: nullable(object({ fileId: isOpaqueId, label: isString, queue: listOf(isOpaqueId) })),
  tracks: nullable(isTrackChoice),
})

export type LocalFile = Infer<typeof isLocalFile>

export const isRecentView = object({
  recentId: isOpaqueId,
  label: isString,
  from: isString,
  watched: nullable(isNumber),
})

export type RecentView = Infer<typeof isRecentView>

const isAudioDevice = object({ name: isString, description: isString })

export type AudioDevice = Infer<typeof isAudioDevice>

export const MENU_PLAYER_ACTIONS = {
  togglePlay: 'togglePlay',
  skipBack: 'skipBack',
  skipForward: 'skipForward',
  next: 'next',
  showShortcuts: 'showShortcuts',
  stats: 'stats',
} as const

export const isMenuPlayerAction = oneOf(Object.values(MENU_PLAYER_ACTIONS))

export type MenuPlayerAction = Infer<typeof isMenuPlayerAction>

/** The release check as Settings shows it: the switch, the running version and the last answer. */
export const isUpdateStatus = object({
  isEnabled: isBoolean,
  current: isString,
  checkedAt: nullable(isNumber),
  latest: nullable(isString),
  problem: nullable(isString),
})

export type UpdateStatus = Infer<typeof isUpdateStatus>

/** What Raven says of a release check, in main's own dialogs and in the page's Settings. */
export const UPDATE_WORDS = {
  newer: (version: string) => `Raven ${version} is out.`,
  current: (version: string) => `Raven ${version} is the newest release.`,
  failed: 'Raven could not check for updates.',
} as const

/** What a page-drawn window control asks of the window; maximize restores a maximized one. */
export const WINDOW_ACTIONS = {
  minimize: 'minimize',
  maximize: 'maximize',
  close: 'close',
} as const

export type WindowAction = (typeof WINDOW_ACTIONS)[keyof typeof WINDOW_ACTIONS]

/** The edge or corner a page-drawn resize handle drags. */
export const WINDOW_EDGES = {
  top: 'top',
  right: 'right',
  bottom: 'bottom',
  left: 'left',
  topLeft: 'topLeft',
  topRight: 'topRight',
  bottomRight: 'bottomRight',
  bottomLeft: 'bottomLeft',
} as const

export type WindowEdge = (typeof WINDOW_EDGES)[keyof typeof WINDOW_EDGES]

export const DESKTOP_REQUESTS = {
  ready: 'ready',
  openDialog: 'openDialog',
  describeFile: 'describeFile',
  savePosition: 'savePosition',
  listRecents: 'listRecents',
  openRecent: 'openRecent',
  removeRecent: 'removeRecent',
  clearRecents: 'clearRecents',
  saveTracks: 'saveTracks',
  windowButtons: 'windowButtons',
  windowControl: 'windowControl',
  startWindowResize: 'startWindowResize',
  moveWindowResize: 'moveWindowResize',
  readOutput: 'readOutput',
  writeOutput: 'writeOutput',
  openLink: 'openLink',
  readUpdates: 'readUpdates',
  setUpdateCheck: 'setUpdateCheck',
  checkForUpdates: 'checkForUpdates',
  openRelease: 'openRelease',
  confirmDownload: 'confirmDownload',
  declineDownload: 'declineDownload',
  retryDownloadAsk: 'retryDownloadAsk',
  listDownloads: 'listDownloads',
  openDownload: 'openDownload',
  pauseDownload: 'pauseDownload',
  resumeDownload: 'resumeDownload',
  retryDownload: 'retryDownload',
  deleteDownload: 'deleteDownload',
  setDownloadAutoDelete: 'setDownloadAutoDelete',
  pauseAllDownloads: 'pauseAllDownloads',
  resumeAllDownloads: 'resumeAllDownloads',
  deleteAllDownloads: 'deleteAllDownloads',
  readSpace: 'readSpace',
  setDownloadDefaults: 'setDownloadDefaults',
  showDownloadsFolder: 'showDownloadsFolder',
  playbackLeft: 'playbackLeft',
  accountToken: 'accountToken',
  askDownload: 'askDownload',
  playTitle: 'playTitle',
} as const

/** What the page asks main for. No variant carries a file path or names a server: main has one. */
export const isDesktopRequest = tagged({
  tag: 'type',
  variants: {
    [DESKTOP_REQUESTS.ready]: {},
    [DESKTOP_REQUESTS.openDialog]: {},
    [DESKTOP_REQUESTS.describeFile]: {
      fileId: isOpaqueId,
      queue: listOf(isOpaqueId),
    },
    [DESKTOP_REQUESTS.savePosition]: {
      fileId: isOpaqueId,
      position: isNumber,
      duration: nullable(isNumber),
    },
    [DESKTOP_REQUESTS.listRecents]: {},
    [DESKTOP_REQUESTS.openRecent]: { recentId: isOpaqueId },
    [DESKTOP_REQUESTS.removeRecent]: { recentId: isOpaqueId },
    [DESKTOP_REQUESTS.clearRecents]: {},
    [DESKTOP_REQUESTS.saveTracks]: {
      fileId: isOpaqueId,
      audio: nullable(isTrackIndex),
      subtitle: nullable(isString),
    },
    [DESKTOP_REQUESTS.windowButtons]: { isVisible: isBoolean },
    [DESKTOP_REQUESTS.windowControl]: { action: oneOf(Object.values(WINDOW_ACTIONS)) },
    // A drag on a resize handle: where it began, in screen coordinates, then where it is now.
    [DESKTOP_REQUESTS.startWindowResize]: {
      edge: oneOf(Object.values(WINDOW_EDGES)),
      x: isNumber,
      y: isNumber,
    },
    [DESKTOP_REQUESTS.moveWindowResize]: { x: isNumber, y: isNumber },
    [DESKTOP_REQUESTS.readOutput]: {},
    [DESKTOP_REQUESTS.writeOutput]: { output: isOutputSettings },
    [DESKTOP_REQUESTS.openLink]: { link: isString },
    [DESKTOP_REQUESTS.readUpdates]: {},
    [DESKTOP_REQUESTS.setUpdateCheck]: { isEnabled: isBoolean },
    [DESKTOP_REQUESTS.checkForUpdates]: {},
    // No URL: main opens the release page it built from the tag (Ruling 19).
    [DESKTOP_REQUESTS.openRelease]: {},
    [DESKTOP_REQUESTS.confirmDownload]: {
      askId: isOpaqueId,
      shouldAutoDelete: isBoolean,
    },
    [DESKTOP_REQUESTS.declineDownload]: { askId: isOpaqueId },
    [DESKTOP_REQUESTS.retryDownloadAsk]: { askId: isOpaqueId },
    [DESKTOP_REQUESTS.listDownloads]: {},
    [DESKTOP_REQUESTS.openDownload]: { downloadId: isOpaqueId },
    [DESKTOP_REQUESTS.pauseDownload]: { downloadId: isOpaqueId },
    [DESKTOP_REQUESTS.resumeDownload]: { downloadId: isOpaqueId },
    [DESKTOP_REQUESTS.retryDownload]: { downloadId: isOpaqueId },
    [DESKTOP_REQUESTS.deleteDownload]: { downloadId: isOpaqueId },
    [DESKTOP_REQUESTS.setDownloadAutoDelete]: {
      downloadId: isOpaqueId,
      shouldAutoDelete: isBoolean,
    },
    [DESKTOP_REQUESTS.pauseAllDownloads]: {},
    [DESKTOP_REQUESTS.resumeAllDownloads]: {},
    [DESKTOP_REQUESTS.deleteAllDownloads]: {},
    [DESKTOP_REQUESTS.readSpace]: {},
    [DESKTOP_REQUESTS.setDownloadDefaults]: { shouldAutoDelete: isBoolean },
    [DESKTOP_REQUESTS.showDownloadsFolder]: {},
    // The play page left this file, so a deletion waiting for the player to leave it can run.
    [DESKTOP_REQUESTS.playbackLeft]: { fileId: isOpaqueId },
    // Sent whenever the page's session changes, and as null once it signs out.
    [DESKTOP_REQUESTS.accountToken]: { session: nullable(isPageSession) },
    [DESKTOP_REQUESTS.askDownload]: { target: isDownloadTarget },
    [DESKTOP_REQUESTS.playTitle]: {
      mediaId: isMediaId,
      at: isSeconds,
      next: isUpNext,
    },
  },
})

export type DesktopRequest = Infer<typeof isDesktopRequest>

/**
 * Why main will not play a title: the page is signed out, its account may not play it (waiting for
 * approval, or removed), its library is locked (the page asks for the PIN, whose unlock main's
 * calls carry, then asks again), the server no longer has it, or the server could not be reached.
 */
export const TITLE_REFUSALS = {
  signedOut: 'signedOut',
  denied: 'denied',
  locked: 'locked',
  gone: 'gone',
  unreachable: 'unreachable',
} as const

export const isTitleRefusal = oneOf(Object.values(TITLE_REFUSALS))

export type TitleRefusal = Infer<typeof isTitleRefusal>

export const DESKTOP_REPLIES = {
  play: 'play',
  file: 'file',
  recents: 'recents',
  output: 'output',
  done: 'done',
  refused: 'refused',
  navigate: 'navigate',
  title: 'title',
  titleRefused: 'titleRefused',
  updates: 'updates',
  downloadAsk: 'downloadAsk',
  downloads: 'downloads',
  space: 'space',
} as const

export const isDesktopReply = tagged({
  tag: 'type',
  variants: {
    [DESKTOP_REPLIES.play]: { target: isPlayTarget },
    [DESKTOP_REPLIES.file]: { file: isLocalFile },
    [DESKTOP_REPLIES.recents]: { recents: listOf(isRecentView) },
    [DESKTOP_REPLIES.output]: {
      output: isOutputSettings,
      devices: listOf(isAudioDevice),
      isEngineReady: isBoolean,
    },
    [DESKTOP_REPLIES.done]: {},
    [DESKTOP_REPLIES.refused]: { message: isString },
    // A link opened from the page's File > Open Link: the page shows this path.
    [DESKTOP_REPLIES.navigate]: { to: isPagePath },
    // What `playTitle` hands the native player: a ready download as a file, else the server's title.
    [DESKTOP_REPLIES.title]: {
      source: isPlayerSource,
      resumeAt: isSeconds,
      next: isUpNext,
    },
    [DESKTOP_REPLIES.titleRefused]: {
      reason: isTitleRefusal,
      message: isString,
    },
    [DESKTOP_REPLIES.updates]: { status: isUpdateStatus },
    [DESKTOP_REPLIES.downloadAsk]: { ask: isDownloadAsk },
    [DESKTOP_REPLIES.downloads]: {
      downloads: listOf(isDownloadView),
      shouldAutoDeleteByDefault: isBoolean,
    },
    [DESKTOP_REPLIES.space]: { space: isSpaceView },
  },
})

export type DesktopReply = Infer<typeof isDesktopReply>

export type DesktopRequestType = DesktopRequest['type']

export type DesktopReplyType = DesktopReply['type']

const R = DESKTOP_REQUESTS
const A = DESKTOP_REPLIES

/** What main answers a page's way of opening something with: a file to play, a page, a download to ask about. */
export const OPEN_REPLY_TYPES = [A.play, A.navigate, A.downloadAsk, A.done] as const

/**
 * The replies main gives each request, besides `refused`, which any request may get: main
 * refuses what it cannot do, and the page reads a reply it cannot check as a refusal.
 */
export const DESKTOP_REPLIES_FOR = {
  [R.ready]: [A.done],
  [R.openDialog]: [A.play, A.done],
  [R.describeFile]: [A.file],
  [R.savePosition]: [A.done],
  [R.listRecents]: [A.recents],
  [R.openRecent]: [A.play],
  [R.removeRecent]: [A.done],
  [R.clearRecents]: [A.done],
  [R.saveTracks]: [A.done],
  [R.windowButtons]: [A.done],
  [R.windowControl]: [A.done],
  [R.startWindowResize]: [A.done],
  [R.moveWindowResize]: [A.done],
  [R.readOutput]: [A.output],
  [R.writeOutput]: [A.done],
  [R.openLink]: [A.navigate, A.downloadAsk],
  [R.readUpdates]: [A.updates],
  [R.setUpdateCheck]: [A.updates],
  [R.checkForUpdates]: [A.updates],
  [R.openRelease]: [A.done],
  [R.confirmDownload]: [A.downloads],
  [R.declineDownload]: [A.done],
  [R.retryDownloadAsk]: [A.downloadAsk],
  [R.listDownloads]: [A.downloads],
  // Main plays a download; a browser that keeps them opens its own play page.
  [R.openDownload]: [A.play, A.navigate],
  [R.pauseDownload]: [A.downloads],
  [R.resumeDownload]: [A.downloads],
  [R.retryDownload]: [A.downloads],
  [R.deleteDownload]: [A.downloads],
  [R.setDownloadAutoDelete]: [A.downloads],
  [R.pauseAllDownloads]: [A.downloads],
  [R.resumeAllDownloads]: [A.downloads],
  [R.deleteAllDownloads]: [A.downloads],
  [R.readSpace]: [A.space],
  [R.setDownloadDefaults]: [A.downloads],
  [R.showDownloadsFolder]: [A.done],
  [R.playbackLeft]: [A.done],
  [R.accountToken]: [A.done],
  [R.askDownload]: [A.downloadAsk],
  [R.playTitle]: [A.title, A.titleRefused],
} as const satisfies Record<DesktopRequestType, readonly DesktopReplyType[]>

/** A reply of one of `types`, or a refusal. */
type ReplyOfType<T extends DesktopReplyType> = Extract<
  DesktopReply,
  { type: T | typeof DESKTOP_REPLIES.refused }
>

/** What main may answer a request of type `T` with. */
export type RepliesFor<T extends DesktopRequestType> = ReplyOfType<
  (typeof DESKTOP_REPLIES_FOR)[T][number]
>

/** What main answers a way of opening something with: the files dropped, a link, a recent. */
export type OpenReply = ReplyOfType<(typeof OPEN_REPLY_TYPES)[number]>

/** The guard for what main answers a request of `type`; anything else the page reads as a refusal. */
export const isReplyTo =
  <T extends DesktopRequestType>(type: T) =>
  (reply: unknown): reply is RepliesFor<T> => {
    if (!isDesktopReply(reply)) return false
    const allowed: readonly DesktopReplyType[] = DESKTOP_REPLIES_FOR[type]
    return reply.type === DESKTOP_REPLIES.refused || allowed.includes(reply.type)
  }

/** Whether `reply` is one main gives a way of opening something. */
export const isOpenReply = (reply: unknown): reply is OpenReply => {
  if (!isDesktopReply(reply)) return false
  const allowed: readonly DesktopReplyType[] = OPEN_REPLY_TYPES
  return reply.type === DESKTOP_REPLIES.refused || allowed.includes(reply.type)
}

export const DESKTOP_EVENTS = {
  play: 'play',
  player: 'player',
  navigate: 'navigate',
  notice: 'notice',
  openLink: 'openLink',
  updateAvailable: 'updateAvailable',
  downloadAsk: 'downloadAsk',
  downloads: 'downloads',
} as const

/**
 * What main pushes on its own: menu actions (File > Open Link among them), `open-file`, links,
 * downloads, notices. `navigate` names a path on the page's origin: Settings from the menu, or a
 * `raven://play` link's `/watch/<mediaId>` with its `WATCH_PARAMS`.
 */
export const isDesktopEvent = tagged({
  tag: 'type',
  variants: {
    [DESKTOP_EVENTS.play]: { target: isPlayTarget },
    [DESKTOP_EVENTS.player]: { action: isMenuPlayerAction },
    [DESKTOP_EVENTS.navigate]: { to: isPagePath },
    [DESKTOP_EVENTS.notice]: { message: isString },
    [DESKTOP_EVENTS.openLink]: {},
    [DESKTOP_EVENTS.updateAvailable]: { version: isString },
    [DESKTOP_EVENTS.downloadAsk]: { ask: isDownloadAsk },
    [DESKTOP_EVENTS.downloads]: {
      downloads: listOf(isDownloadView),
      shouldAutoDeleteByDefault: isBoolean,
    },
  },
})

export type DesktopEvent = Infer<typeof isDesktopEvent>

export const ENVELOPE_KINDS = { page: 'page', drop: 'drop' } as const

/**
 * What the preload sends on the request channel. The preload builds it, so a
 * request from the page can never be mistaken for a drop, and only a drop
 * carries paths (taken from the dropped files by `webUtils`, never from the page).
 */
export const isInvokeEnvelope = tagged({
  tag: 'kind',
  variants: {
    [ENVELOPE_KINDS.page]: { request: isDesktopRequest },
    [ENVELOPE_KINDS.drop]: { paths: listOf(isString) },
  },
})

export type InvokeEnvelope = Infer<typeof isInvokeEnvelope>

export const PLAYER_CONNECTION_STATUSES = { native: 'native', unavailable: 'unavailable' } as const

export const isPlayerConnection = tagged({
  tag: 'status',
  variants: {
    [PLAYER_CONNECTION_STATUSES.native]: {},
    [PLAYER_CONNECTION_STATUSES.unavailable]: { message: isString },
  },
})

export type PlayerConnectionStatus = Infer<typeof isPlayerConnection>

/** What the preload forwards to the page on each `ready`; the port, when there is one, rides with it. */
export const isPlayerPortMessage = object({
  type: literal(WINDOW_MESSAGE_TYPES.playerPort),
  connection: isPlayerConnection,
})

/** The music engine's hand-over, which rides the same way and carries the same kind of answer. */
export const isAudioPortMessage = object({
  type: literal(WINDOW_MESSAGE_TYPES.audioPort),
  connection: isPlayerConnection,
})
