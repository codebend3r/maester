import { type Infer, isNumber, isString, listOf, nullable, object, oneOf, union } from '@raven/core'

export const APP_ORIGIN = 'app://raven'
export const APP_SCHEME = 'app'
export const APP_HOST = 'raven'
export const FILE_SCHEME = 'raven-file'
export const REQUEST_CHANNEL = 'raven:request'
export const EVENT_CHANNEL = 'raven:event'
export const MAX_QUEUE = 100

// A standard scheme lowercases its host, so an id must already be lowercase to
// survive a round trip through `raven-file://<id>`.
const OPAQUE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** What `crypto.randomUUID()` returns: the only handle the page ever holds for a file. */
export const isOpaqueId = (value: unknown): value is string =>
  isString(value) && OPAQUE_ID.test(value)

export const fileUrlFor = (fileId: string): string => `${FILE_SCHEME}://${fileId}`

export const isPlayTarget = object({ fileId: isOpaqueId, queue: listOf(isOpaqueId) })

export type PlayTarget = Infer<typeof isPlayTarget>

export const isLocalFile = object({
  fileId: isOpaqueId,
  label: isString,
  folder: isString,
  resumeAt: isNumber,
  next: nullable(object({ fileId: isOpaqueId, label: isString, queue: listOf(isOpaqueId) })),
})

export type LocalFile = Infer<typeof isLocalFile>

export const isRecentView = object({
  recentId: isOpaqueId,
  label: isString,
  from: isString,
  watched: nullable(isNumber),
})

export type RecentView = Infer<typeof isRecentView>

export const isMenuPlayerAction = oneOf([
  'togglePlay',
  'skipBack',
  'skipForward',
  'next',
  'showShortcuts',
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
)

export type DesktopRequest = Infer<typeof isDesktopRequest>

export const isDesktopReply = union(
  object({ type: oneOf(['play']), target: isPlayTarget }),
  object({ type: oneOf(['file']), file: isLocalFile }),
  object({ type: oneOf(['recents']), recents: listOf(isRecentView) }),
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
