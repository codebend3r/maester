import {
  type AlbumSummary,
  type Artist,
  MUSIC_SORTS,
  type MusicSort,
  artistNames,
  randomMusicSeed,
} from '@raven/core'

import { byTitle } from '@/library/order'
import { RECENT_SORTS, type RecentSort } from '@/prefs'

/**
 * The order Albums or Songs is in: one of raven's music sorts, the same list in the same order
 * with the same words (core's `MUSIC_SORT_LABELS`), and the seed a random order is dealt by.
 */
export type ListOrder = { sort: MusicSort; seed: number }

/** Where Albums and Songs start: by title. */
export const FIRST_LIST_ORDER = { sort: MUSIC_SORTS.title, seed: 0 } as const satisfies ListOrder

/** The order a sort picked from the sheet gives, a random one dealt anew each pick. */
export const listOrderOf = (sort: MusicSort): ListOrder => ({ sort, seed: randomMusicSeed() })

type AlbumPair = { a: AlbumSummary; b: AlbumSummary; seed: number }

type AlbumOrder = (pair: AlbumPair) => number

/** When an album came out, as the server orders by it: its date, else its year, else nothing. */
const releasedOf = ({ releaseDate, year }: AlbumSummary): string | null =>
  releaseDate ?? (year === null ? null : String(year))

type NewestFirstProps = { a: string | null | undefined; b: string | null | undefined }

/** Newest first, an undated one last. */
const newestFirst = ({ a, b }: NewestFirstProps): number => (b ?? '').localeCompare(a ?? '')

/** Albums as a discography reads: by year, the undated last, then by title. */
const byYear = (a: AlbumSummary, b: AlbumSummary): number =>
  (a.year ?? Number.MAX_SAFE_INTEGER) - (b.year ?? Number.MAX_SAFE_INTEGER) || byTitle(a, b)

type ShuffleRankProps = { id: number; seed: number }

/** An album's place in a random order dealt by `seed`, the server's own hash of its id. */
const shuffleRankOf = ({ id, seed }: ShuffleRankProps): number =>
  (id * (1103515245 + seed * 2)) % 2147483647

/**
 * How each of raven's sorts puts albums in order, in its default direction, as the server
 * lists one library's (`ALBUM_ORDER` in its music repository), so several libraries merge into
 * the same order.
 */
const ALBUM_ORDERS = {
  [MUSIC_SORTS.title]: ({ a, b }) => byTitle(a, b),
  [MUSIC_SORTS.artist]: ({ a, b }) => artistNames(a).localeCompare(artistNames(b)) || byYear(a, b),
  [MUSIC_SORTS.year]: ({ a, b }) => byYear(a, b),
  [MUSIC_SORTS.added]: ({ a, b }) => b.addedAt.localeCompare(a.addedAt) || b.id - a.id,
  [MUSIC_SORTS.release]: ({ a, b }) =>
    newestFirst({ a: releasedOf(a), b: releasedOf(b) }) || a.id - b.id,
  [MUSIC_SORTS.played]: ({ a, b }) => newestFirst({ a: a.playedAt, b: b.playedAt }) || a.id - b.id,
  [MUSIC_SORTS.plays]: ({ a, b }) => (b.plays ?? 0) - (a.plays ?? 0) || a.id - b.id,
  [MUSIC_SORTS.random]: ({ a, b, seed }) =>
    shuffleRankOf({ id: a.id, seed }) - shuffleRankOf({ id: b.id, seed }) || a.id - b.id,
  [MUSIC_SORTS.modified]: ({ a, b }) =>
    newestFirst({ a: a.modifiedAt, b: b.modifiedAt }) || a.id - b.id,
} as const satisfies Record<MusicSort, AlbumOrder>

type SortedAlbumsProps = { albums: readonly AlbumSummary[]; order: ListOrder }

/** The albums in the order `order` names, a new list each time. */
export const sortedAlbums = ({
  albums,
  order: { sort, seed },
}: SortedAlbumsProps): AlbumSummary[] =>
  albums.toSorted((a, b) => ALBUM_ORDERS[sort]({ a, b, seed }))

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

type RecentAlbumsProps = { albums: readonly AlbumSummary[]; sort: RecentSort; limit: number }

/** The newest `limit` of several libraries' newest albums by `sort`, newest first, as Albums orders them. */
export const recentAlbums = ({ albums, sort, limit }: RecentAlbumsProps): AlbumSummary[] =>
  sortedAlbums({ albums, order: { sort: RECENT_SERVER_SORTS[sort], seed: 0 } }).slice(0, limit)
