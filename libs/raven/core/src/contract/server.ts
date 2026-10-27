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

export const SERVER_EVENT_TYPES = { library: 'library' } as const

/**
 * What the server tells a client as it happens: a library's videos changed,
 * so whatever shows them should be read again.
 */
export const isServerEvent = object({
  type: oneOf(Object.values(SERVER_EVENT_TYPES)),
  libraryId: isNumber,
})

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
