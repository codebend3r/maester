import { ITEM_TYPES, type MatchItemType, UPCOMING_SHELVES, type UpcomingShelf } from '@raven/core'
import { DOCUMENTARY_FILTERS, type DocumentaryFilter } from '@/metadata/tmdbClient'

/** One of TMDB's discover lists a shelf reads: a kind of title, with documentaries alone or kept out. */
export type ShelfStream = { type: MatchItemType; documentaries: DocumentaryFilter }

/** The lists each of Coming soon's shelves merges: documentaries take both kinds. */
export const SHELF_STREAMS = {
  [UPCOMING_SHELVES.movies]: [{ type: ITEM_TYPES.movie, documentaries: DOCUMENTARY_FILTERS.never }],
  [UPCOMING_SHELVES.shows]: [{ type: ITEM_TYPES.show, documentaries: DOCUMENTARY_FILTERS.never }],
  [UPCOMING_SHELVES.documentaries]: [
    { type: ITEM_TYPES.movie, documentaries: DOCUMENTARY_FILTERS.only },
    { type: ITEM_TYPES.show, documentaries: DOCUMENTARY_FILTERS.only },
  ],
} as const satisfies Record<UpcomingShelf, readonly ShelfStream[]>
