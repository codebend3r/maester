import { HTTP_METHODS, isSeconds, isTrack, isTrackIndex } from '@/contract'
import { watchPageOf } from '@/itemLinks'
import { isDownloadTarget, isMediaId, PLAY_LINK_MAX_NEXT } from '@/playLink'
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
  union,
} from '@/schema'

export const FILE_SCHEME = 'raven-file'
/** The preload's hand-overs: the video player's port, and the music engine's. */
export const WINDOW_MESSAGE_TYPES = {
  playerPort: 'raven:player-port',
  audioPort: 'raven:audio-port',
} as const
/** Main's words once mpv has gone. They ride with reason `engine`, which is what the page reads. */
export const ENGINE_STOPPED = "Raven's video engine stopped. Open the video again."

// A standard scheme lowercases its host, so an id must already be lowercase to
// survive a round trip through `raven-file://<id>`.
const OPAQUE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** What `crypto.randomUUID()` returns: the only handle the page ever holds for a file. */
export const isOpaqueId = matching(OPAQUE_ID)

export const fileUrlFor = (fileId: string): string => `${FILE_SCHEME}://${fileId}`

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

/**
 * The web's watch page for a title, with where to start (whole seconds, left out at 0) and the
 * titles after it (left out when there are none).
 */
export const watchPathFor = ({ mediaId, at, next }: { mediaId: number } & WatchQuery): string => {
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

export const isDownloadStatus = union(
  object({ kind: oneOf([DOWNLOAD_STATUS_KINDS.queued]) }),
  object({ kind: oneOf([DOWNLOAD_STATUS_KINDS.downloading]), bytes: isNumber }),
  object({
    kind: oneOf([DOWNLOAD_STATUS_KINDS.paused]),
    bytes: isNumber,
    message: nullable(isString),
  }),
  object({ kind: oneOf([DOWNLOAD_STATUS_KINDS.failed]), bytes: isNumber, message: isString }),
  object({ kind: oneOf([DOWNLOAD_STATUS_KINDS.ready]) }),
)

export type DownloadStatus = Infer<typeof isDownloadStatus>

export const DOWNLOAD_ARTWORK_KINDS = { poster: 'poster', cover: 'cover', none: 'none' } as const

/**
 * The picture a download shows, as the ids and version the server's capability address names:
 * a title's poster, an album's cover for audio, or nothing. No origin or path, so the page builds
 * the address itself and a title the server has no picture for shows its initial.
 */
export const isDownloadArtwork = union(
  object({
    kind: oneOf([DOWNLOAD_ARTWORK_KINDS.poster]),
    itemId: isNumber,
    version: isString,
  }),
  object({
    kind: oneOf([DOWNLOAD_ARTWORK_KINDS.cover]),
    albumId: isNumber,
    version: isString,
  }),
  object({ kind: oneOf([DOWNLOAD_ARTWORK_KINDS.none]) }),
)

export type DownloadArtwork = Infer<typeof isDownloadArtwork>

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
export const isDownloadAskStatus = union(
  object({
    kind: oneOf([DOWNLOAD_ASK_KINDS.ready]),
    title: isString,
    downloadKind: isDownloadKind,
    files: isNumber,
    bytes: isNumber,
    free: isNumber,
    canFit: isBoolean,
  }),
  object({ kind: oneOf([DOWNLOAD_ASK_KINDS.locked]) }),
  object({ kind: oneOf([DOWNLOAD_ASK_KINDS.account]) }),
)

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
export const isDesktopRequest = union(
  object({ type: oneOf([DESKTOP_REQUESTS.ready]) }),
  object({ type: oneOf([DESKTOP_REQUESTS.openDialog]) }),
  object({
    type: oneOf([DESKTOP_REQUESTS.describeFile]),
    fileId: isOpaqueId,
    queue: listOf(isOpaqueId),
  }),
  object({
    type: oneOf([DESKTOP_REQUESTS.savePosition]),
    fileId: isOpaqueId,
    position: isNumber,
    duration: nullable(isNumber),
  }),
  object({ type: oneOf([DESKTOP_REQUESTS.listRecents]) }),
  object({ type: oneOf([DESKTOP_REQUESTS.openRecent]), recentId: isOpaqueId }),
  object({ type: oneOf([DESKTOP_REQUESTS.removeRecent]), recentId: isOpaqueId }),
  object({ type: oneOf([DESKTOP_REQUESTS.clearRecents]) }),
  object({
    type: oneOf([DESKTOP_REQUESTS.saveTracks]),
    fileId: isOpaqueId,
    audio: nullable(isTrackIndex),
    subtitle: nullable(isString),
  }),
  object({ type: oneOf([DESKTOP_REQUESTS.windowButtons]), isVisible: isBoolean }),
  object({
    type: oneOf([DESKTOP_REQUESTS.windowControl]),
    action: oneOf(Object.values(WINDOW_ACTIONS)),
  }),
  // A drag on a resize handle: where it began, in screen coordinates, then where it is now.
  object({
    type: oneOf([DESKTOP_REQUESTS.startWindowResize]),
    edge: oneOf(Object.values(WINDOW_EDGES)),
    x: isNumber,
    y: isNumber,
  }),
  object({ type: oneOf([DESKTOP_REQUESTS.moveWindowResize]), x: isNumber, y: isNumber }),
  object({ type: oneOf([DESKTOP_REQUESTS.readOutput]) }),
  object({ type: oneOf([DESKTOP_REQUESTS.writeOutput]), output: isOutputSettings }),
  object({ type: oneOf([DESKTOP_REQUESTS.openLink]), link: isString }),
  object({ type: oneOf([DESKTOP_REQUESTS.readUpdates]) }),
  object({ type: oneOf([DESKTOP_REQUESTS.setUpdateCheck]), isEnabled: isBoolean }),
  object({ type: oneOf([DESKTOP_REQUESTS.checkForUpdates]) }),
  // No URL: main opens the release page it built from the tag (Ruling 19).
  object({ type: oneOf([DESKTOP_REQUESTS.openRelease]) }),
  object({
    type: oneOf([DESKTOP_REQUESTS.confirmDownload]),
    askId: isOpaqueId,
    shouldAutoDelete: isBoolean,
  }),
  object({ type: oneOf([DESKTOP_REQUESTS.declineDownload]), askId: isOpaqueId }),
  object({ type: oneOf([DESKTOP_REQUESTS.retryDownloadAsk]), askId: isOpaqueId }),
  object({ type: oneOf([DESKTOP_REQUESTS.listDownloads]) }),
  object({ type: oneOf([DESKTOP_REQUESTS.openDownload]), downloadId: isOpaqueId }),
  object({ type: oneOf([DESKTOP_REQUESTS.pauseDownload]), downloadId: isOpaqueId }),
  object({ type: oneOf([DESKTOP_REQUESTS.resumeDownload]), downloadId: isOpaqueId }),
  object({ type: oneOf([DESKTOP_REQUESTS.retryDownload]), downloadId: isOpaqueId }),
  object({ type: oneOf([DESKTOP_REQUESTS.deleteDownload]), downloadId: isOpaqueId }),
  object({
    type: oneOf([DESKTOP_REQUESTS.setDownloadAutoDelete]),
    downloadId: isOpaqueId,
    shouldAutoDelete: isBoolean,
  }),
  object({ type: oneOf([DESKTOP_REQUESTS.pauseAllDownloads]) }),
  object({ type: oneOf([DESKTOP_REQUESTS.resumeAllDownloads]) }),
  object({ type: oneOf([DESKTOP_REQUESTS.deleteAllDownloads]) }),
  object({ type: oneOf([DESKTOP_REQUESTS.readSpace]) }),
  object({ type: oneOf([DESKTOP_REQUESTS.setDownloadDefaults]), shouldAutoDelete: isBoolean }),
  object({ type: oneOf([DESKTOP_REQUESTS.showDownloadsFolder]) }),
  // The play page left this file, so a deletion waiting for the player to leave it can run.
  object({ type: oneOf([DESKTOP_REQUESTS.playbackLeft]), fileId: isOpaqueId }),
  // Sent whenever the page's session changes, and as null once it signs out.
  object({ type: oneOf([DESKTOP_REQUESTS.accountToken]), session: nullable(isPageSession) }),
  object({ type: oneOf([DESKTOP_REQUESTS.askDownload]), target: isDownloadTarget }),
  object({
    type: oneOf([DESKTOP_REQUESTS.playTitle]),
    mediaId: isMediaId,
    at: isSeconds,
    next: isUpNext,
  }),
)

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

export const isDesktopReply = union(
  object({ type: oneOf([DESKTOP_REPLIES.play]), target: isPlayTarget }),
  object({ type: oneOf([DESKTOP_REPLIES.file]), file: isLocalFile }),
  object({ type: oneOf([DESKTOP_REPLIES.recents]), recents: listOf(isRecentView) }),
  object({
    type: oneOf([DESKTOP_REPLIES.output]),
    output: isOutputSettings,
    devices: listOf(isAudioDevice),
    isEngineReady: isBoolean,
  }),
  object({ type: oneOf([DESKTOP_REPLIES.done]) }),
  object({ type: oneOf([DESKTOP_REPLIES.refused]), message: isString }),
  // A link opened from the page's File > Open Link: the page shows this path.
  object({ type: oneOf([DESKTOP_REPLIES.navigate]), to: isPagePath }),
  // What `playTitle` hands the native player: a ready download as a file, else the server's title.
  object({
    type: oneOf([DESKTOP_REPLIES.title]),
    source: isPlayerSource,
    resumeAt: isSeconds,
    next: isUpNext,
  }),
  object({
    type: oneOf([DESKTOP_REPLIES.titleRefused]),
    reason: isTitleRefusal,
    message: isString,
  }),
  object({ type: oneOf([DESKTOP_REPLIES.updates]), status: isUpdateStatus }),
  object({ type: oneOf([DESKTOP_REPLIES.downloadAsk]), ask: isDownloadAsk }),
  object({
    type: oneOf([DESKTOP_REPLIES.downloads]),
    downloads: listOf(isDownloadView),
    shouldAutoDeleteByDefault: isBoolean,
  }),
  object({ type: oneOf([DESKTOP_REPLIES.space]), space: isSpaceView }),
)

export type DesktopReply = Infer<typeof isDesktopReply>

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
export const isDesktopEvent = union(
  object({ type: oneOf([DESKTOP_EVENTS.play]), target: isPlayTarget }),
  object({ type: oneOf([DESKTOP_EVENTS.player]), action: isMenuPlayerAction }),
  object({ type: oneOf([DESKTOP_EVENTS.navigate]), to: isPagePath }),
  object({ type: oneOf([DESKTOP_EVENTS.notice]), message: isString }),
  object({ type: oneOf([DESKTOP_EVENTS.openLink]) }),
  object({ type: oneOf([DESKTOP_EVENTS.updateAvailable]), version: isString }),
  object({ type: oneOf([DESKTOP_EVENTS.downloadAsk]), ask: isDownloadAsk }),
  object({
    type: oneOf([DESKTOP_EVENTS.downloads]),
    downloads: listOf(isDownloadView),
    shouldAutoDeleteByDefault: isBoolean,
  }),
)

export type DesktopEvent = Infer<typeof isDesktopEvent>

export const ENVELOPE_KINDS = { page: 'page', drop: 'drop' } as const

/**
 * What the preload sends on the request channel. The preload builds it, so a
 * request from the page can never be mistaken for a drop, and only a drop
 * carries paths (taken from the dropped files by `webUtils`, never from the page).
 */
export const isInvokeEnvelope = union(
  object({ kind: oneOf([ENVELOPE_KINDS.page]), request: isDesktopRequest }),
  object({ kind: oneOf([ENVELOPE_KINDS.drop]), paths: listOf(isString) }),
)

export type InvokeEnvelope = Infer<typeof isInvokeEnvelope>

export const PLAYER_CONNECTION_STATUSES = { native: 'native', unavailable: 'unavailable' } as const

export const isPlayerConnection = union(
  object({ status: oneOf([PLAYER_CONNECTION_STATUSES.native]) }),
  object({ status: oneOf([PLAYER_CONNECTION_STATUSES.unavailable]), message: isString }),
)

export type PlayerConnectionStatus = Infer<typeof isPlayerConnection>

/** What the preload forwards to the page on each `ready`; the port, when there is one, rides with it. */
export const isPlayerPortMessage = object({
  type: oneOf([WINDOW_MESSAGE_TYPES.playerPort]),
  connection: isPlayerConnection,
})

/** The music engine's hand-over, which rides the same way and carries the same kind of answer. */
export const isAudioPortMessage = object({
  type: oneOf([WINDOW_MESSAGE_TYPES.audioPort]),
  connection: isPlayerConnection,
})
