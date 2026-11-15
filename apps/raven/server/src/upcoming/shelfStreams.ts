import { ITEM_TYPES, type MatchItemType, UPCOMING_SHELVES, type UpcomingShelf } from '@raven/core'
import { UPCOMING_LISTS, type UpcomingList } from '@/metadata/tmdbClient'

/** How long one of Coming soon's reads of TMDB is served before TMDB is asked again. */
export const UPCOMING_FRESH_MS = 6 * 60 * 60 * 1000

/** One of TMDB's discover lists a shelf reads: a kind of title, of one of the lists of titles still to come. */
export type ShelfStream = { type: MatchItemType; list: UpcomingList }

/** The lists each of Coming soon's shelves merges: documentaries and anime take both kinds. */
export const SHELF_STREAMS = {
  [UPCOMING_SHELVES.movies]: [{ type: ITEM_TYPES.movie, list: UPCOMING_LISTS.general }],
  [UPCOMING_SHELVES.shows]: [{ type: ITEM_TYPES.show, list: UPCOMING_LISTS.general }],
  [UPCOMING_SHELVES.documentaries]: [
    { type: ITEM_TYPES.movie, list: UPCOMING_LISTS.documentaries },
    { type: ITEM_TYPES.show, list: UPCOMING_LISTS.documentaries },
  ],
  [UPCOMING_SHELVES.anime]: [
    { type: ITEM_TYPES.movie, list: UPCOMING_LISTS.anime },
    { type: ITEM_TYPES.show, list: UPCOMING_LISTS.anime },
  ],
} as const satisfies Record<UpcomingShelf, readonly ShelfStream[]>
