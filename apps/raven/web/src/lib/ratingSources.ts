import { RATING_SOURCES, type RatingSource } from '@raven/core'

export const RATING_SOURCE_LABELS = {
  [RATING_SOURCES.tmdb]: 'TMDB',
  [RATING_SOURCES.imdb]: 'IMDb',
  [RATING_SOURCES.rottenTomatoes]: 'Rotten Tomatoes',
  [RATING_SOURCES.metacritic]: 'Metacritic',
} as const satisfies Record<RatingSource, string>
