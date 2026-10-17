import type { MatchItemType, MetadataServiceState, RatingSource } from '@raven/core'

/** Where a score came from. */
export type ScoreProvider = 'omdb' | 'mdblist'

/** A score from an outside source, out of 10 whatever its source counts in. */
export type ExternalScore = {
  source: Exclude<RatingSource, 'tmdb'>
  value: number
  votes: number | null
}

/** A movie or show to ask about: by its TMDB id, and its IMDb id when it has one. */
export type ScoreTitle = { type: MatchItemType; tmdbId: string; imdbId: string | null }

/**
 * A place to ask for a title's IMDb, Rotten Tomatoes and Metacritic scores.
 * A failure throws; `'unknown'` is an answer, for a title the source has
 * nothing on.
 */
export type ScoreSource = {
  provider: ScoreProvider
  /** Whether there is a key, it has not been refused, and today's calls are not spent. */
  enabled: () => boolean
  /** Whether there is a key it has not had refused, whether or not today's calls are spent. */
  hasUsableKey: () => boolean
  /** How many calls are left today. */
  remaining: () => number
  state: () => MetadataServiceState
  lookUp: (title: ScoreTitle) => Promise<ExternalScore[] | 'unknown'>
}
