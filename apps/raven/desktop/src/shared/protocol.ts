import {
  type Infer,
  isBoolean,
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
export const REQUEST_CHANNEL = 'raven:request'
export const EVENT_CHANNEL = 'raven:event'
export const MAX_QUEUE = 100
export const PLAYER_PORT_CHANNEL = 'raven:player'
export const PLAYER_PORT_MESSAGE = 'raven:player-port'
/** Main's words once mpv has gone. They ride with reason `engine`, which is what the page reads. */
export const ENGINE_STOPPED = "raven player's video engine stopped. Open the video again."

// A standard scheme lowercases its host, so an id must already be lowercase to
// survive a round trip through `raven-file://<id>`.
const OPAQUE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** What `crypto.randomUUID()` returns: the only handle the page ever holds for a file. */
export const isOpaqueId = (value: unknown): value is string =>
  isString(value) && OPAQUE_ID.test(value)

export const fileUrlFor = (fileId: string): string => `${FILE_SCHEME}://${fileId}`

export const isPlayTarget = object({ fileId: isOpaqueId, queue: listOf(isOpaqueId) })

export type PlayTarget = Infer<typeof isPlayTarget>

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

export const isMenuPlayerAction = oneOf([
  'togglePlay',
  'skipBack',
  'skipForward',
  'next',
  'showShortcuts',
  'stats',
])

export type MenuPlayerAction = Infer<typeof isMenuPlayerAction>

/** What the page asks main for. No variant carries a path. */
export const isDesktopRequest = union(
  object({ type: oneOf(['ready']) }),
  object({ type: oneOf(['openDialog']) }),
  object({ type: oneOf(['describeFile']), fileId: isOpaqueId, queue: listOf(isOpaqueId) }),
  object({
    type: oneOf(['savePosition']),
    fileId: isOpaqueId,
    position: isNumber,
    duration: nullable(isNumber),
  }),
  object({ type: oneOf(['listRecents']) }),
  object({ type: oneOf(['openRecent']), recentId: isOpaqueId }),
  object({ type: oneOf(['removeRecent']), recentId: isOpaqueId }),
  object({ type: oneOf(['clearRecents']) }),
  object({
    type: oneOf(['saveTracks']),
    fileId: isOpaqueId,
    audio: nullable(isTrackIndex),
    subtitle: nullable(isString),
  }),
  object({ type: oneOf(['windowButtons']), isVisible: isBoolean }),
  object({ type: oneOf(['readOutput']) }),
  object({ type: oneOf(['writeOutput']), output: isOutputSettings }),
)

export type DesktopRequest = Infer<typeof isDesktopRequest>

export const isDesktopReply = union(
  object({ type: oneOf(['play']), target: isPlayTarget }),
  object({ type: oneOf(['file']), file: isLocalFile }),
  object({ type: oneOf(['recents']), recents: listOf(isRecentView) }),
  object({
    type: oneOf(['output']),
    output: isOutputSettings,
    devices: listOf(isAudioDevice),
    isEngineReady: isBoolean,
  }),
  object({ type: oneOf(['done']) }),
  object({ type: oneOf(['refused']), message: isString }),
)

export type DesktopReply = Infer<typeof isDesktopReply>

/** What main pushes on its own: menu actions, `open-file`, notices. */
export const isDesktopEvent = union(
  object({ type: oneOf(['play']), target: isPlayTarget }),
  object({ type: oneOf(['player']), action: isMenuPlayerAction }),
  object({ type: oneOf(['navigate']), to: oneOf(['settings']) }),
  object({ type: oneOf(['notice']), message: isString }),
)

export type DesktopEvent = Infer<typeof isDesktopEvent>

/**
 * What the preload sends on the request channel. The preload builds it, so a
 * request from the page can never be mistaken for a drop, and only a drop
 * carries paths (taken from the dropped files by `webUtils`, never from the page).
 */
export const isInvokeEnvelope = union(
  object({ kind: oneOf(['page']), request: isDesktopRequest }),
  object({ kind: oneOf(['drop']), paths: listOf(isString) }),
)

export type InvokeEnvelope = Infer<typeof isInvokeEnvelope>

export const isPlayerConnection = union(
  object({ status: oneOf(['native']) }),
  object({ status: oneOf(['unavailable']), message: isString }),
)

export type PlayerConnectionStatus = Infer<typeof isPlayerConnection>

/** What the preload forwards to the page on each `ready`; the port, when there is one, rides with it. */
export const isPlayerPortMessage = object({
  type: oneOf([PLAYER_PORT_MESSAGE]),
  connection: isPlayerConnection,
})
