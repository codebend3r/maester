import { ITEM_TYPES, type MatchItemType } from '@raven/core'

/** What TMDB's site calls each kind of title in its addresses. */
const TMDB_SITE_SEGMENTS = {
  [ITEM_TYPES.movie]: 'movie',
  [ITEM_TYPES.show]: 'tv',
} as const satisfies Record<MatchItemType, string>

type TmdbTitleUrlProps = { type: MatchItemType; tmdbId: string }

/** A movie's or show's page on TMDB, for one raven does not hold. */
export const tmdbTitleUrl = ({ type, tmdbId }: TmdbTitleUrlProps): string =>
  `https://www.themoviedb.org/${TMDB_SITE_SEGMENTS[type]}/${tmdbId}`
