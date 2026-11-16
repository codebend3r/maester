import {
  ITEM_TYPES,
  type MatchItemType,
  TMDB_GENRES,
  UPCOMING_KINDS,
  type UpcomingKind,
} from '@raven/core'
import { ANIME_LANGUAGE } from '@/metadata/tmdbClient'

/** What TMDB says of a title that tells its kind: its genres' ids and the language it was made in. */
export type KindFacts = { genreIds: readonly number[]; originalLanguage: string | null }

/** Whether a title is anime, as the anime list asks TMDB for it: animation made in Japanese. */
export const isAnime = ({ genreIds, originalLanguage }: KindFacts): boolean =>
  originalLanguage === ANIME_LANGUAGE && genreIds.includes(TMDB_GENRES.animation)

const ANIME_KINDS = {
  [ITEM_TYPES.movie]: UPCOMING_KINDS.animeMovie,
  [ITEM_TYPES.show]: UPCOMING_KINDS.animeShow,
} as const satisfies Record<MatchItemType, UpcomingKind>

const PLAIN_KINDS = {
  [ITEM_TYPES.movie]: UPCOMING_KINDS.movie,
  [ITEM_TYPES.show]: UPCOMING_KINDS.show,
} as const satisfies Record<MatchItemType, UpcomingKind>

type UpcomingKindOfProps = KindFacts & { type: MatchItemType }

/** The kind a title's own page names, as Coming soon shelves it: a documentary first, then anime, else a movie or a show. */
export const upcomingKindOf = ({ type, ...facts }: UpcomingKindOfProps): UpcomingKind => {
  if (facts.genreIds.includes(TMDB_GENRES.documentary)) return UPCOMING_KINDS.documentary
  return isAnime(facts) ? ANIME_KINDS[type] : PLAIN_KINDS[type]
}
