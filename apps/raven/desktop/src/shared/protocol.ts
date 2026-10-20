import {
  type Infer,
  isBoolean,
  isMediaId,
  isNumber,
  isOutputSettings,
  isString,
  listOf,
  nullable,
  object,
  oneOf,
  union,
} from '@raven/core'

export const APP_ORIGIN = 'app://raven'
export const APP_SCHEME = 'app'
export const APP_HOST = 'raven'
export const FILE_SCHEME = 'raven-file'
export const IPC_CHANNELS = {
  request: 'raven:request',
  event: 'raven:event',
  player: 'raven:player',
} as const
export const MAX_QUEUE = 100
export const WINDOW_MESSAGE_TYPES = { playerPort: 'raven:player-port' } as const
/** Main's words once mpv has gone. They ride with reason `engine`, which is what the page reads. */
export const ENGINE_STOPPED = "raven player's video engine stopped. Open the video again."
/**
 * Main's words for a server raven player no longer keeps. The page reads them to drop
 * "Open in browser", which main would refuse, so both sides use this one constant.
 */
export const SERVER_GONE = 'That server is no longer in raven player.'

// A standard scheme lowercases its host, so an id must already be lowercase to
// survive a round trip through `raven-file://<id>`.
const OPAQUE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** What `crypto.randomUUID()` returns: the only handle the page ever holds for a file. */
export const isOpaqueId = (value: unknown): value is string =>
  isString(value) && OPAQUE_ID.test(value)

export const fileUrlFor = (fileId: string): string => `${FILE_SCHEME}://${fileId}`

export const isPlayTarget = object({ fileId: isOpaqueId, queue: listOf(isOpaqueId) })

export type PlayTarget = Infer<typeof isPlayTarget>

/** A title on a trusted server, by ids only: the page never holds the server's origin. */
export const isServerTarget = object({
  serverId: isOpaqueId,
  mediaId: isMediaId,
  at: isNumber,
  next: listOf(isMediaId),
})

export type ServerTarget = Infer<typeof isServerTarget>

export const HTTP_METHODS = {
  get: 'GET',
  head: 'HEAD',
  put: 'PUT',
  post: 'POST',
  delete: 'DELETE',
} as const

/** The methods a server call may use; the app's own protocols also answer HEAD. */
export const SERVER_METHODS = {
  get: HTTP_METHODS.get,
  put: HTTP_METHODS.put,
  post: HTTP_METHODS.post,
} as const

/** The methods a page's server call may use; main matches each call against the allowlist besides. */
export const isServerMethod = oneOf(Object.values(SERVER_METHODS))

/** A stored server as Settings shows it. */
export const isServerView = object({ serverId: isOpaqueId, origin: isString, name: isString })

export type ServerView = Infer<typeof isServerView>

/** A container becomes `video.<container>` on disk, so only a short lowercase name passes. */
export const isContainerName = (value: unknown): value is string =>
  isString(value) && /^[a-z0-9]{1,8}$/u.test(value)

/** A sidecar's track id becomes `subtitles/<trackId>.vtt` on disk, so only the server's `external-<n>` passes. */
export const isSidecarTrackId = (value: unknown): value is string =>
  isString(value) && /^external-\d+$/u.test(value)

export const DOWNLOAD_KINDS = {
  movie: 'movie',
  episode: 'episode',
  season: 'season',
  show: 'show',
  saga: 'saga',
} as const

export const isDownloadKind = oneOf(Object.values(DOWNLOAD_KINDS))

export type DownloadKind = Infer<typeof isDownloadKind>

/**
 * Where a download sits in its group. `key` names the group on its server: `show:<itemId>` for an
 * episode, season or show, `saga:<libraryId>:<tmdbId>` or `movie:<mediaId>`. `order` is the play
 * order, a season times 10000 plus the episode, or a saga's index.
 */
export const isDownloadGroup = object({
  kind: isDownloadKind,
  key: isString,
  title: isString,
  order: isNumber,
})

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

/** Whether the sign-in to a server's accounts is open, waiting on its owner, closed or out of reach. */
export const ACCOUNT_STATES = {
  off: 'off',
  unavailable: 'unavailable',
  signedOut: 'signedOut',
  pending: 'pending',
  revoked: 'revoked',
  approved: 'approved',
  failed: 'failed',
} as const

const isAccountState = oneOf(Object.values(ACCOUNT_STATES))

/**
 * A server's account as the page sees it: never a token, a Supabase address or a key. The email is
 * the signed in person's own, and `signInHost` is the host the sign-in goes to, for the page to name.
 */
export const isAccountView = object({
  serverId: isOpaqueId,
  state: isAccountState,
  email: nullable(isString),
  isRemembered: isBoolean,
  signInHost: nullable(isString),
})

export type AccountView = Infer<typeof isAccountView>

export const DOWNLOAD_ASK_KINDS = {
  ready: 'ready',
  locked: 'locked',
  hidden: 'hidden',
  account: 'account',
} as const

/**
 * What the download dialog shows: the files to fetch, the lock to lift before main can list them,
 * or the account to sign in with, or to have approved, on a server whose accounts are ready.
 */
export const isDownloadAskStatus = union(
  object({
    kind: oneOf([DOWNLOAD_ASK_KINDS.ready]),
    title: isString,
    downloadKind: isDownloadKind,
    files: isNumber,
    bytes: isNumber,
    free: isNumber,
    fits: isBoolean,
  }),
  object({ kind: oneOf([DOWNLOAD_ASK_KINDS.locked]) }),
  object({ kind: oneOf([DOWNLOAD_ASK_KINDS.hidden]) }),
  object({ kind: oneOf([DOWNLOAD_ASK_KINDS.account]), account: isAccountView }),
)

export type DownloadAskStatus = Infer<typeof isDownloadAskStatus>

/** A download link main has expanded and holds under `askId` until the page answers it. */
export const isDownloadAsk = object({
  askId: isOpaqueId,
  serverId: isOpaqueId,
  serverName: isString,
  autoDelete: isBoolean,
  status: isDownloadAskStatus,
})

export type DownloadAsk = Infer<typeof isDownloadAsk>

/** A download as the page shows it: it and its server by opaque ids, with no media id, origin or path. */
export const isDownloadView = object({
  downloadId: isOpaqueId,
  serverId: isOpaqueId,
  label: isString,
  group: isDownloadGroup,
  serverName: isString,
  size: isNumber,
  status: isDownloadStatus,
  autoDelete: isBoolean,
  watched: nullable(isNumber),
  deletesAt: nullable(isNumber),
  needsUnlock: isBoolean,
})

export type DownloadView = Infer<typeof isDownloadView>

export const isSpaceView = object({ free: isNumber, total: isNumber, used: isNumber })

export type SpaceView = Infer<typeof isSpaceView>

/** The longest PIN, password or email main takes from the page. */
export const MAX_SECRET = 256

/** The server pages Create account and Forgot password open; main builds the address itself. */
export const ACCOUNT_PAGES = { signUp: 'signUp', forgot: 'forgot' } as const

export const isAccountPage = oneOf(Object.values(ACCOUNT_PAGES))

export type AccountPage = Infer<typeof isAccountPage>

const isSecretText = (value: unknown): value is string =>
  isString(value) && value.length <= MAX_SECRET

/** An audio track's index as a pick names it: a whole number, 0 or more. */
export const isTrackIndex = (value: unknown): value is number =>
  isNumber(value) && Number.isInteger(value) && value >= 0

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
  readOutput: 'readOutput',
  writeOutput: 'writeOutput',
  serverCall: 'serverCall',
  listServers: 'listServers',
  addServer: 'addServer',
  renameServer: 'renameServer',
  removeServer: 'removeServer',
  openLink: 'openLink',
  openInBrowser: 'openInBrowser',
  noteServerTitle: 'noteServerTitle',
  leaveServerTitle: 'leaveServerTitle',
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
  readAccount: 'readAccount',
  refreshAccount: 'refreshAccount',
  signIn: 'signIn',
  signOut: 'signOut',
  openAccountPage: 'openAccountPage',
} as const

/** What the page asks main for. No variant carries a file path; a server call names its server by id. */
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
  object({ type: oneOf([DESKTOP_REQUESTS.readOutput]) }),
  object({ type: oneOf([DESKTOP_REQUESTS.writeOutput]), output: isOutputSettings }),
  object({
    type: oneOf([DESKTOP_REQUESTS.serverCall]),
    serverId: isOpaqueId,
    method: isServerMethod,
    path: isString,
    body: nullable(isString),
  }),
  object({ type: oneOf([DESKTOP_REQUESTS.listServers]) }),
  object({ type: oneOf([DESKTOP_REQUESTS.addServer]), origin: isString }),
  object({ type: oneOf([DESKTOP_REQUESTS.renameServer]), serverId: isOpaqueId, name: isString }),
  object({ type: oneOf([DESKTOP_REQUESTS.removeServer]), serverId: isOpaqueId }),
  object({ type: oneOf([DESKTOP_REQUESTS.openLink]), link: isString }),
  object({
    type: oneOf([DESKTOP_REQUESTS.openInBrowser]),
    serverId: isOpaqueId,
    mediaId: isMediaId,
  }),
  object({
    type: oneOf([DESKTOP_REQUESTS.noteServerTitle]),
    serverId: isOpaqueId,
    mediaId: isMediaId,
    label: isString,
    watched: nullable(isNumber),
  }),
  object({
    type: oneOf([DESKTOP_REQUESTS.leaveServerTitle]),
    serverId: isOpaqueId,
    mediaId: isMediaId,
  }),
  object({ type: oneOf([DESKTOP_REQUESTS.readUpdates]) }),
  object({ type: oneOf([DESKTOP_REQUESTS.setUpdateCheck]), isEnabled: isBoolean }),
  object({ type: oneOf([DESKTOP_REQUESTS.checkForUpdates]) }),
  // No URL: main opens the release page it built from the tag (Ruling 19).
  object({ type: oneOf([DESKTOP_REQUESTS.openRelease]) }),
  object({
    type: oneOf([DESKTOP_REQUESTS.confirmDownload]),
    askId: isOpaqueId,
    autoDelete: isBoolean,
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
    autoDelete: isBoolean,
  }),
  object({ type: oneOf([DESKTOP_REQUESTS.pauseAllDownloads]) }),
  object({ type: oneOf([DESKTOP_REQUESTS.resumeAllDownloads]) }),
  object({ type: oneOf([DESKTOP_REQUESTS.deleteAllDownloads]) }),
  object({ type: oneOf([DESKTOP_REQUESTS.readSpace]) }),
  object({ type: oneOf([DESKTOP_REQUESTS.setDownloadDefaults]), autoDelete: isBoolean }),
  object({ type: oneOf([DESKTOP_REQUESTS.showDownloadsFolder]) }),
  // The play page left this file, so a deletion waiting for the player to leave it can run.
  object({ type: oneOf([DESKTOP_REQUESTS.playbackLeft]), fileId: isOpaqueId }),
  object({ type: oneOf([DESKTOP_REQUESTS.readAccount]), serverId: isOpaqueId }),
  object({ type: oneOf([DESKTOP_REQUESTS.refreshAccount]), serverId: isOpaqueId }),
  // The one request that carries a password: main hands it to the sign-in host and keeps no copy.
  object({
    type: oneOf([DESKTOP_REQUESTS.signIn]),
    serverId: isOpaqueId,
    email: isSecretText,
    password: isSecretText,
  }),
  object({ type: oneOf([DESKTOP_REQUESTS.signOut]), serverId: isOpaqueId }),
  object({
    type: oneOf([DESKTOP_REQUESTS.openAccountPage]),
    serverId: isOpaqueId,
    page: isAccountPage,
  }),
)

export type DesktopRequest = Infer<typeof isDesktopRequest>

export const DESKTOP_REPLIES = {
  play: 'play',
  playServer: 'playServer',
  file: 'file',
  recents: 'recents',
  output: 'output',
  done: 'done',
  refused: 'refused',
  serverReply: 'serverReply',
  serverUnreachable: 'serverUnreachable',
  servers: 'servers',
  updates: 'updates',
  downloadAsk: 'downloadAsk',
  downloads: 'downloads',
  space: 'space',
  account: 'account',
} as const

export const isDesktopReply = union(
  object({ type: oneOf([DESKTOP_REPLIES.play]), target: isPlayTarget }),
  object({ type: oneOf([DESKTOP_REPLIES.playServer]), target: isServerTarget }),
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
  object({ type: oneOf([DESKTOP_REPLIES.serverReply]), status: isNumber, body: isString }),
  object({ type: oneOf([DESKTOP_REPLIES.serverUnreachable]), message: isString }),
  object({ type: oneOf([DESKTOP_REPLIES.servers]), servers: listOf(isServerView) }),
  object({ type: oneOf([DESKTOP_REPLIES.updates]), status: isUpdateStatus }),
  object({ type: oneOf([DESKTOP_REPLIES.downloadAsk]), ask: isDownloadAsk }),
  object({
    type: oneOf([DESKTOP_REPLIES.downloads]),
    downloads: listOf(isDownloadView),
    autoDeleteDefault: isBoolean,
  }),
  object({ type: oneOf([DESKTOP_REPLIES.space]), space: isSpaceView }),
  object({ type: oneOf([DESKTOP_REPLIES.account]), account: isAccountView }),
)

export type DesktopReply = Infer<typeof isDesktopReply>

export const DESKTOP_EVENTS = {
  play: 'play',
  player: 'player',
  navigate: 'navigate',
  notice: 'notice',
  playServer: 'playServer',
  openLink: 'openLink',
  updateAvailable: 'updateAvailable',
  downloadAsk: 'downloadAsk',
  downloads: 'downloads',
  account: 'account',
  accountSwitched: 'accountSwitched',
} as const

export const NAVIGATION_TARGETS = { settings: 'settings' } as const

/** What main pushes on its own: menu actions (File > Open Link among them), `open-file`, links, downloads, notices. */
export const isDesktopEvent = union(
  object({ type: oneOf([DESKTOP_EVENTS.play]), target: isPlayTarget }),
  object({ type: oneOf([DESKTOP_EVENTS.player]), action: isMenuPlayerAction }),
  object({ type: oneOf([DESKTOP_EVENTS.navigate]), to: oneOf(Object.values(NAVIGATION_TARGETS)) }),
  object({ type: oneOf([DESKTOP_EVENTS.notice]), message: isString }),
  object({ type: oneOf([DESKTOP_EVENTS.playServer]), target: isServerTarget }),
  object({ type: oneOf([DESKTOP_EVENTS.openLink]) }),
  object({ type: oneOf([DESKTOP_EVENTS.updateAvailable]), version: isString }),
  object({ type: oneOf([DESKTOP_EVENTS.downloadAsk]), ask: isDownloadAsk }),
  object({
    type: oneOf([DESKTOP_EVENTS.downloads]),
    downloads: listOf(isDownloadView),
    autoDeleteDefault: isBoolean,
  }),
  // Main's view of a server's account changed on its own: a refresh failed, or a call was refused.
  object({ type: oneOf([DESKTOP_EVENTS.account]), account: isAccountView }),
  // Another account, or none, is signed in to the server now. It names the server, never an account.
  object({ type: oneOf([DESKTOP_EVENTS.accountSwitched]), serverId: isOpaqueId }),
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
