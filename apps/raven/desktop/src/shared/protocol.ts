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

export const HTTP_METHODS = { get: 'GET', head: 'HEAD', put: 'PUT', post: 'POST' } as const

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

/** An audio track's index as a pick names it: a whole number, 0 or more. */
export const isTrackIndex = (value: unknown): value is number =>
  isNumber(value) && Number.isInteger(value) && value >= 0

export const isTrackChoice = object({ audio: nullable(isNumber), subtitle: nullable(isString) })

export type TrackChoice = Infer<typeof isTrackChoice>

export const isLocalFile = object({
  fileId: isOpaqueId,
  label: isString,
  folder: isString,
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

export const isAudioDevice = object({ name: isString, description: isString })

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
  readUpdates: 'readUpdates',
  setUpdateCheck: 'setUpdateCheck',
  checkForUpdates: 'checkForUpdates',
  openRelease: 'openRelease',
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
  object({ type: oneOf([DESKTOP_REQUESTS.readUpdates]) }),
  object({ type: oneOf([DESKTOP_REQUESTS.setUpdateCheck]), isEnabled: isBoolean }),
  object({ type: oneOf([DESKTOP_REQUESTS.checkForUpdates]) }),
  // No URL: main opens the release page it built from the tag (Ruling 19).
  object({ type: oneOf([DESKTOP_REQUESTS.openRelease]) }),
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
} as const

export const NAVIGATION_TARGETS = { settings: 'settings' } as const

/** What main pushes on its own: menu actions (File > Open Link among them), `open-file`, links, notices. */
export const isDesktopEvent = union(
  object({ type: oneOf([DESKTOP_EVENTS.play]), target: isPlayTarget }),
  object({ type: oneOf([DESKTOP_EVENTS.player]), action: isMenuPlayerAction }),
  object({ type: oneOf([DESKTOP_EVENTS.navigate]), to: oneOf(Object.values(NAVIGATION_TARGETS)) }),
  object({ type: oneOf([DESKTOP_EVENTS.notice]), message: isString }),
  object({ type: oneOf([DESKTOP_EVENTS.playServer]), target: isServerTarget }),
  object({ type: oneOf([DESKTOP_EVENTS.openLink]) }),
  object({ type: oneOf([DESKTOP_EVENTS.updateAvailable]), version: isString }),
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
