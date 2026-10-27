import { isMediaItem } from '@/contract/items'
import {
  type Guard,
  type Infer,
  exactPartial,
  isNumber,
  isString,
  keyOf,
  listOf,
  matching,
  nullable,
  object,
  oneOf,
  union,
} from '@/schema'

/** The fields Edit metadata can write over: what a page shows for a movie or show. */
export const isItemMetadata = object({
  title: isString,
  year: nullable(isNumber),
  tagline: nullable(isString),
  summary: nullable(isString),
  contentRating: nullable(isString),
})

export type ItemMetadata = Infer<typeof isItemMetadata>

/** Edit metadata: what the page shows, what TMDB says, and which fields were written over. */
export const isItemMetadataState = object({
  shown: isItemMetadata,
  original: isItemMetadata,
  overridden: listOf(keyOf(isItemMetadata.shape)),
})

export type ItemMetadataState = Infer<typeof isItemMetadataState>

/** Only known fields, each text, a number for the year, or null; nothing else. */
export const isItemMetadataChange = exactPartial({
  title: nullable(isString),
  year: nullable(isNumber),
  tagline: nullable(isString),
  summary: nullable(isString),
  contentRating: nullable(isString),
} satisfies { [K in keyof ItemMetadata]: Guard<ItemMetadata[K] | null> })

/**
 * What Edit metadata sends: each field given is written over, or cleared
 * back to TMDB's with null. An empty field over TMDB's words is '', or 0 for
 * the year, and shows as nothing; a title cannot be empty.
 */
export type ItemMetadataChange = Infer<typeof isItemMetadataChange>

/** TMDB's ids are digits, which raven keeps as text. */
export const isTmdbId = matching(/^\d+$/)

/** A TV documentary kept as a movie uses a separate namespace from TMDB's movie ids. */
export const TMDB_MATCH_PREFIXES = { tvMovie: 'tv:' } as const

export const isTvMovieId = (
  value: unknown,
): value is `${typeof TMDB_MATCH_PREFIXES.tvMovie}${string}` =>
  isString(value) &&
  value.startsWith(TMDB_MATCH_PREFIXES.tvMovie) &&
  isTmdbId(value.slice(TMDB_MATCH_PREFIXES.tvMovie.length))

/** A movie or show match, including a TV documentary watched as one movie. */
export const isMatchId = (value: unknown): value is string => isTmdbId(value) || isTvMovieId(value)

/** One of TMDB's search results, offered by Fix match. */
export const isMatchCandidate = object({
  tmdbId: isString,
  title: isString,
  year: nullable(isNumber),
  overview: nullable(isString),
  /** TMDB's path for the poster, served through `candidatePosterUrl`. */
  poster: nullable(isString),
  /** How sure Fix match is that this is the folder's or file's movie or show: a whole number from 0 to 100. */
  confidence: isNumber,
})

export type MatchCandidate = Infer<typeof isMatchCandidate>

export const isMatchCandidateList = listOf(isMatchCandidate)

export const MATCH_SUBJECT_KINDS = { media: 'media', item: 'item' } as const

/** What a Fix match search is for: a file (and the show folder it is in), or a matched show. */
export const isMatchSubject = union(
  object({ kind: oneOf([MATCH_SUBJECT_KINDS.media]), id: isNumber }),
  object({ kind: oneOf([MATCH_SUBJECT_KINDS.item]), id: isNumber }),
)

export type MatchSubject = Infer<typeof isMatchSubject>

/** A place inside a library, as the server keeps a group's Fix match: a relative path, never an absolute one. */
export const isLibraryPlace = (value: unknown): value is string =>
  isString(value) && value !== '' && !value.startsWith('/')

/**
 * A movie or show the AI lookup offers for files it was not sure of.
 * Accepting it is a Fix match to `tmdbId`.
 */
export const isAiSuggestion = object({
  tmdbId: isMatchId,
  title: isString,
  year: nullable(isNumber),
  /** TMDB's path for the poster, served through `candidatePosterUrl`. */
  poster: nullable(isString),
  /** Why Claude thinks so, in a sentence or two. */
  reason: isString,
  /**
   * The group the lookup was asked about: a show's folder, a movie's folder
   * when it holds that one movie, else the movie file's own place.
   */
  place: isLibraryPlace,
})

export type AiSuggestion = Infer<typeof isAiSuggestion>

/** A file no movie or show was found for, as Not matched lists it. */
export const isUnmatchedFile = object({
  ...isMediaItem.shape,
  /** What the AI lookup suggests for its folder; null when it was not asked, chose nothing, or is sure. */
  aiSuggestion: nullable(isAiSuggestion),
})

export type UnmatchedFile = Infer<typeof isUnmatchedFile>

export const isUnmatchedList = listOf(isUnmatchedFile)

/** `PUT /api/media/:id/match`: a TMDB id for Fix match, or null for a file that is not one at all. */
export const isMatchChoice = object({
  tmdbId: nullable(isMatchId),
})

export type MatchChoice = Infer<typeof isMatchChoice>

/** `PUT /api/items/:id/match`: the TMDB show to point a show's files at. */
export const isShowMatchChoice = object({
  tmdbId: isTmdbId,
})

export type ShowMatchChoice = Infer<typeof isShowMatchChoice>
