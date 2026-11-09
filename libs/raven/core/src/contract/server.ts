import { isNotification } from '@/contract/notifications'
import { isEncoderKind } from '@/contract/settings'
import {
  type Infer,
  isBoolean,
  isNumber,
  isString,
  listOf,
  nullable,
  object,
  oneOf,
  union,
} from '@/schema'

/** `off` when not configured, `failing` when the last call went wrong. */
export const METADATA_SERVICE_STATES = { off: 'off', ok: 'ok', failing: 'failing' } as const

export const isMetadataServiceState = oneOf(Object.values(METADATA_SERVICE_STATES))

export type MetadataServiceState = Infer<typeof isMetadataServiceState>

/** How metadata is doing, from `/api/health`. */
export const isMetadataHealth = object({
  tmdb: isMetadataServiceState,
  omdb: isMetadataServiceState,
  mdblist: isMetadataServiceState,
  /** Files waiting to be matched. */
  pending: isNumber,
  /** Why TMDB is failing, never the token itself. */
  error: nullable(isString),
  /** When TMDB last answered. */
  lastOk: nullable(isString),
  /** The AI lookup: `off` without ANTHROPIC_API_KEY, `failing` when its last call went wrong. */
  ai: isMetadataServiceState,
  /** AI lookups left today; 0 while it is off. */
  aiRemaining: isNumber,
  /** Groups waiting for or in an AI lookup, across libraries; 0 between passes. */
  aiPending: isNumber,
})

export type MetadataHealth = Infer<typeof isMetadataHealth>

export const HEALTH_STATUSES = { ok: 'ok' } as const

/** What `/api/health` answers: the server is up, and how its parts are doing. */
export const isServerHealth = object({
  status: oneOf(Object.values(HEALTH_STATUSES)),
  /** null when ffmpeg is missing, in which case nothing but direct play works. */
  ffmpeg: nullable(isString),
  /** Whether HDR thumbnails and transcodes get tone mapped to SDR. */
  tonemap: isBoolean,
  /** What transcodes encode with: the CPU, or a GPU through VAAPI or VideoToolbox. */
  encoder: isEncoderKind,
  thumbnailsPending: isNumber,
  /** Whether TMDB is configured and answering, and how many files wait to be matched. */
  metadata: isMetadataHealth,
})

export type ServerHealth = Infer<typeof isServerHealth>

/** Where a video's file lives, as the server sees it (a container path under Docker). */
export const isMediaLocation = object({
  path: isString,
})

export type MediaLocation = Infer<typeof isMediaLocation>

export const SERVER_EVENT_TYPES = {
  library: 'library',
  viewing: 'viewing',
  binge: 'binge',
  notification: 'notification',
} as const

/**
 * What the server tells a client as it happens, so whatever shows it is read again: a library's
 * videos changed; the account's viewing changed (a spot saved, a play counted, a mark made) on
 * any of its devices; the account's binge list changed; or the account was notified of
 * something, already logged, for its screens to show as a toast. The last three go only to
 * the account's own streams and name no account.
 */
export const isServerEvent = union(
  object({ type: oneOf([SERVER_EVENT_TYPES.library]), libraryId: isNumber }),
  object({ type: oneOf([SERVER_EVENT_TYPES.viewing]) }),
  object({ type: oneOf([SERVER_EVENT_TYPES.binge]) }),
  object({ type: oneOf([SERVER_EVENT_TYPES.notification]), notification: isNotification }),
)

export type ServerEvent = Infer<typeof isServerEvent>

export const isDirectoryEntry = object({
  name: isString,
  path: isString,
})

export type DirectoryEntry = Infer<typeof isDirectoryEntry>

export const isDirectoryListing = object({
  path: isString,
  /** null at the browse root, where the server will not go any higher. */
  parent: nullable(isString),
  directories: listOf(isDirectoryEntry),
})

export type DirectoryListing = Infer<typeof isDirectoryListing>
