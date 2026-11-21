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
export const FILTER_CHIPS = [
  { key: SEARCH_FILTERS.all, label: FILTER_LABELS[SEARCH_FILTERS.all] },
  { key: SEARCH_FILTERS.songs, label: FILTER_LABELS[SEARCH_FILTERS.songs] },
  { key: SEARCH_FILTERS.albums, label: FILTER_LABELS[SEARCH_FILTERS.albums] },
  { key: SEARCH_FILTERS.artists, label: FILTER_LABELS[SEARCH_FILTERS.artists] },
] as const

/** The two layouts All is drawn for, named as each app names its form factors. */
const SEARCH_LAYOUTS = { phone: 'phone', tablet: 'tablet' } as const

/** How many songs All shows on each layout; See all opens the rest, a page at a time. */
export const SONGS_IN_ALL = {
  [SEARCH_LAYOUTS.phone]: 8,
  [SEARCH_LAYOUTS.tablet]: 6,
} as const satisfies Record<keyof typeof SEARCH_LAYOUTS, number>

/** All's albums on the wide layout: two rows of four. */
export const ALBUMS_IN_ALL = 8
