import type { MatchItemType, MetadataServiceState, RATING_SOURCES, RatingSource } from '@raven/core'

/** Where a score came from. */
export const SCORE_PROVIDERS = { omdb: 'omdb', mdblist: 'mdblist' } as const

export type ScoreProvider = (typeof SCORE_PROVIDERS)[keyof typeof SCORE_PROVIDERS]

/** A score from an outside source, out of 10 whatever its source counts in. */
export type ExternalScore = {
  source: Exclude<RatingSource, typeof RATING_SOURCES.tmdb>
  value: number
  votes: number | null
}

/** A movie or show to ask about: by its TMDB id, and its IMDb id when it has one. */
export type ScoreTitle = { type: MatchItemType; tmdbId: string; imdbId: string | null }

/** What a source answers for a title it has nothing on, as against failing. */
export const SCORE_ANSWERS = { unknown: 'unknown' } as const

/** A source's answer: the title's scores, or that it knows nothing of the title. */
export type ScoreAnswer = ExternalScore[] | typeof SCORE_ANSWERS.unknown

/**
 * A place to ask for a title's IMDb, Rotten Tomatoes and Metacritic scores.
 * A failure throws; `SCORE_ANSWERS.unknown` is an answer, for a title the
 * source has nothing on.
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
  lookUp: (title: ScoreTitle) => Promise<ScoreAnswer>
}
