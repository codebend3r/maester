import { isMediaItem } from '@/contract/items'
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
import { MAX_WATCH_TARGETS } from '@/watched'

/** A video in a library's history: when it last played or was marked, how often it really played, and how far it got. */
export const isHistoryEntry = object({
  media: isMediaItem,
  lastPlayedAt: isString,
  plays: isNumber,
  /** The furthest any play got, in seconds. */
  furthest: isNumber,
  /** Whether a play got to the library's watched percentage, or a mark holds it watched. */
  watched: isBoolean,
  /** Whether Mark as watched holds it watched; `plays` and `furthest` count real plays only. */
  marked: isBoolean,
})

export type HistoryEntry = Infer<typeof isHistoryEntry>

export const isHistory = listOf(isHistoryEntry)

/*
 * Request bodies: what a client sends, checked by the server with the same
 * guard the client's call is typed by.
 */

/** A spot in a file, in seconds from its start. */
const isSeconds = (value: unknown): value is number => isNumber(value) && value >= 0

/** `PUT /api/media/:id/progress`: where playback got to. */
export const isProgressChange = object({
  position: isSeconds,
})

export type ProgressChange = Infer<typeof isProgressChange>

/** An audio track's place among the file's, as ffmpeg's `0:a:N` counts them. */
const isTrackIndex = (value: unknown): value is number =>
  isNumber(value) && Number.isInteger(value) && value >= 0

/**
 * The same route from a player that names what it plays: the position, and
 * the audio track playing, or null when it cannot tell. A body without
 * `audio` is an older player's `ProgressChange`.
 */
export const isProgressReport = object({
  ...isProgressChange.shape,
  audio: nullable(isTrackIndex),
})

export type ProgressReport = Infer<typeof isProgressReport>

/** `PUT /api/media/:id/favourite`. */
export const isFavouriteChange = object({
  favourite: isBoolean,
})

export type FavouriteChange = Infer<typeof isFavouriteChange>

export const WATCH_TARGET_KINDS = { media: 'media', item: 'item' } as const

/**
 * What `PUT /api/watched` marks: the card a file is on, or every card under
 * an item (a show, season, episode or movie) in one library, or in every
 * library the viewer may see when `libraryId` is null.
 */
export const isWatchTarget = union(
  object({ kind: oneOf([WATCH_TARGET_KINDS.media]), id: isNumber }),
  object({
    kind: oneOf([WATCH_TARGET_KINDS.item]),
    id: isNumber,
    libraryId: nullable(isNumber),
  }),
)

export type WatchTarget = Infer<typeof isWatchTarget>

const isWatchTargets = (value: unknown): value is WatchTarget[] =>
  listOf(isWatchTarget)(value) && value.length > 0 && value.length <= MAX_WATCH_TARGETS

/** `PUT /api/watched`: mark every target, from one to `MAX_WATCH_TARGETS`, watched or unwatched. */
export const isWatchedChange = object({
  watched: isBoolean,
  targets: isWatchTargets,
})

export type WatchedChange = Infer<typeof isWatchedChange>
