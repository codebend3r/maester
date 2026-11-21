import { SEARCH_COPY } from '@/copy/screens'

/** What the chips narrow the results to. */
export const SEARCH_FILTERS = {
  all: 'all',
  songs: 'songs',
  albums: 'albums',
  artists: 'artists',
} as const

export type SearchFilter = (typeof SEARCH_FILTERS)[keyof typeof SEARCH_FILTERS]

/** What each filter is called, on its chip and over its section in All. */
export const FILTER_LABELS = {
  [SEARCH_FILTERS.all]: SEARCH_COPY.all,
  [SEARCH_FILTERS.songs]: SEARCH_COPY.songs,
  [SEARCH_FILTERS.albums]: SEARCH_COPY.albums,
  [SEARCH_FILTERS.artists]: SEARCH_COPY.artists,
} as const satisfies Record<SearchFilter, string>

/** The chips, in the order they show. */
export const FILTER_CHIPS = Object.values(SEARCH_FILTERS).map((key) => ({
  key,
  label: FILTER_LABELS[key],
}))

/** How many songs All shows on a phone and on a tablet; See all opens the rest, a page at a time. */
export const SONGS_IN_ALL = { phone: 8, tablet: 6 } as const

/** All's albums on the wide layout: two rows of four. */
export const ALBUMS_IN_ALL = 8
