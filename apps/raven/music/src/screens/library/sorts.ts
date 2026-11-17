import { type AlbumSummary, MUSIC_SORTS, type MusicSort, artistNames } from '@raven/core'

import { byTitle } from '@/music/merged'
import { LIBRARY_PAGE_COPY } from '@/screens/copy'

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
  const needle = query.trim().toLocaleLowerCase()
  if (needle === '') return albums
  return albums.filter(
    (album) =>
      album.title.toLocaleLowerCase().includes(needle) ||
      artistNames(album).toLocaleLowerCase().includes(needle),
  )
}

type NewestAlbumsProps = { albums: readonly AlbumSummary[]; limit: number }

/** The newest `limit` of several libraries' newest albums, newest first. */
export const newestAlbums = ({ albums, limit }: NewestAlbumsProps): AlbumSummary[] =>
  sortedAlbums({ albums, sort: LIST_SORTS.added }).slice(0, limit)
