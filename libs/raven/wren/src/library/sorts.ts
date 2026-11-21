import {
  type AlbumSummary,
  type Artist,
  MUSIC_SORTS,
  type MusicSort,
  artistNames,
} from '@raven/core'

import { byTitle } from '@/library/order'
import { LIBRARY_PAGE_COPY } from '@/copy/screens'
import { RECENT_SORTS, type RecentSort } from '@/prefs'

/** The orders Albums and Songs offer. */
export const LIST_SORTS = {
  title: 'title',
  artist: 'artist',
  year: 'year',
  added: 'added',
} as const

export type ListSort = (typeof LIST_SORTS)[keyof typeof LIST_SORTS]

/** The sorts in the order the sort sheet lists them. */
export const LIST_SORT_ORDER = Object.values(LIST_SORTS)

/** What each sort is called on its button and in the sheet. */
export const LIST_SORT_LABELS = {
  [LIST_SORTS.title]: LIBRARY_PAGE_COPY.sorts.title,
  [LIST_SORTS.artist]: LIBRARY_PAGE_COPY.sorts.artist,
  [LIST_SORTS.year]: LIBRARY_PAGE_COPY.sorts.year,
  [LIST_SORTS.added]: LIBRARY_PAGE_COPY.sorts.added,
} as const satisfies Record<ListSort, string>

/** The server's sort for each, which pages the songs in that order. */
export const SERVER_SORTS = {
  [LIST_SORTS.title]: MUSIC_SORTS.title,
  [LIST_SORTS.artist]: MUSIC_SORTS.artist,
  [LIST_SORTS.year]: MUSIC_SORTS.year,
  [LIST_SORTS.added]: MUSIC_SORTS.added,
} as const satisfies Record<ListSort, MusicSort>

type AlbumOrder = (a: AlbumSummary, b: AlbumSummary) => number

/** How each sort puts albums in order: by title, by artist, newest year first, newest added first. */
const ALBUM_ORDERS = {
  [LIST_SORTS.title]: byTitle,
  [LIST_SORTS.artist]: (a, b) => artistNames(a).localeCompare(artistNames(b)) || byTitle(a, b),
  [LIST_SORTS.year]: (a, b) => (b.year ?? 0) - (a.year ?? 0) || byTitle(a, b),
  [LIST_SORTS.added]: (a, b) => b.addedAt.localeCompare(a.addedAt) || byTitle(a, b),
} as const satisfies Record<ListSort, AlbumOrder>

type SortedAlbumsProps = { albums: readonly AlbumSummary[]; sort: ListSort }

/** The albums in the order `sort` names, a new list each time. */
export const sortedAlbums = ({ albums, sort }: SortedAlbumsProps): AlbumSummary[] =>
  albums.toSorted(ALBUM_ORDERS[sort])

type MatchingAlbumsProps = { albums: readonly AlbumSummary[]; query: string }

/** The albums whose title or artists hold `query`, ignoring case; every album for none. */
export const matchingAlbums = ({ albums, query }: MatchingAlbumsProps): readonly AlbumSummary[] => {
  const needle = query.toLocaleLowerCase()
  if (needle === '') return albums
  return albums.filter(
    (album) =>
      album.title.toLocaleLowerCase().includes(needle) ||
      artistNames(album).toLocaleLowerCase().includes(needle),
  )
}

type MatchingArtistsProps = { artists: readonly Artist[]; query: string }

/** The artists whose name holds `query`, ignoring case; every artist for none. */
export const matchingArtists = ({ artists, query }: MatchingArtistsProps): readonly Artist[] => {
  const needle = query.toLocaleLowerCase()
  if (needle === '') return artists
  return artists.filter((artist) => artist.name.toLocaleLowerCase().includes(needle))
}

/** The server's sort for each, which lists a library's albums in that order. */
export const RECENT_SERVER_SORTS = {
  [RECENT_SORTS.added]: MUSIC_SORTS.added,
  [RECENT_SORTS.release]: MUSIC_SORTS.release,
} as const satisfies Record<RecentSort, MusicSort>

/** When an album came out, as the server orders by it: its date, else its year, else nothing. */
const releasedOf = ({ releaseDate, year }: AlbumSummary): string =>
  releaseDate ?? (year === null ? '' : String(year))

/** How each puts several libraries' albums in one order, newest first, an undated release last. */
const RECENT_ORDERS = {
  [RECENT_SORTS.added]: ALBUM_ORDERS[LIST_SORTS.added],
  [RECENT_SORTS.release]: (a, b) => releasedOf(b).localeCompare(releasedOf(a)) || byTitle(a, b),
} as const satisfies Record<RecentSort, AlbumOrder>

type RecentAlbumsProps = { albums: readonly AlbumSummary[]; sort: RecentSort; limit: number }

/** The newest `limit` of several libraries' newest albums by `sort`, newest first. */
export const recentAlbums = ({ albums, sort, limit }: RecentAlbumsProps): AlbumSummary[] =>
  albums.toSorted(RECENT_ORDERS[sort]).slice(0, limit)
