import { describe, expect, it } from 'bun:test'
import {
  ALBUM_TYPES,
  type AlbumSummary,
  type Artist,
  MATCH_STATES,
  MUSIC_SORTS,
  type MusicSort,
} from '@raven/core'

import {
  FIRST_LIST_ORDER,
  RECENT_SERVER_SORTS,
  listOrderOf,
  openingAlbumsOrderOf,
  matchingAlbums,
  matchingArtists,
  recentAlbums,
  sortedAlbums,
} from '@/library/sorts'
import { RECENT_SORTS } from '@/prefs'

type AlbumForProps = {
  id: number
  title: string
  artist: string
  year: number | null
  addedAt: string
  trackCount?: number
}

const albumFor = ({
  id,
  title,
  artist,
  year,
  addedAt,
  trackCount = 10,
}: AlbumForProps): AlbumSummary => ({
  id,
  libraryId: 5,
  title,
  sortTitle: title,
  year,
  releaseDate: null,
  type: ALBUM_TYPES.album,
  artists: [{ id, name: artist }],
  isCompilation: false,
  trackCount,
  duration: 2400,
  coverVersion: null,
  match: MATCH_STATES.matched,
  addedAt,
})

const KID_A = albumFor({
  id: 1,
  title: 'Kid A',
  artist: 'Radiohead',
  year: 2000,
  addedAt: '2026-01-02T00:00:00Z',
})
const BLUE = albumFor({
  id: 2,
  title: 'Blue',
  artist: 'Joni Mitchell',
  year: 1971,
  addedAt: '2026-03-01T00:00:00Z',
  trackCount: 3,
})
const AMNESIAC = albumFor({
  id: 3,
  title: 'Amnesiac',
  artist: 'Radiohead',
  year: null,
  addedAt: '2026-02-01T00:00:00Z',
})

const ALBUMS = [KID_A, BLUE, AMNESIAC]

const idsOf = (albums: readonly AlbumSummary[]) => albums.map(({ id }) => id)

const orderedBy = (sort: MusicSort, seed = 0) =>
  idsOf(sortedAlbums({ albums: ALBUMS, order: { sort, seed } }))

describe('sortedAlbums', () => {
  it("puts albums in each of raven's orders, as the server lists one library's", () => {
    expect(orderedBy(MUSIC_SORTS.title)).toEqual([3, 2, 1])
    expect(orderedBy(MUSIC_SORTS.artist)).toEqual([2, 1, 3])
    expect(orderedBy(MUSIC_SORTS.year)).toEqual([2, 1, 3])
    expect(orderedBy(MUSIC_SORTS.added)).toEqual([2, 3, 1])
    expect(orderedBy(MUSIC_SORTS.release)).toEqual([1, 2, 3])
  })

  it('puts the most played and the latest played first, the unplayed last', () => {
    const albums = [
      { ...KID_A, plays: 2, playedAt: '2026-03-01T00:00:00Z' },
      { ...BLUE, plays: 5, playedAt: '2026-01-01T00:00:00Z' },
      { ...AMNESIAC, plays: 0, playedAt: null },
    ]
    const by = (sort: MusicSort) => idsOf(sortedAlbums({ albums, order: { sort, seed: 0 } }))
    expect(by(MUSIC_SORTS.plays)).toEqual([2, 1, 3])
    expect(by(MUSIC_SORTS.played)).toEqual([1, 2, 3])
  })

  it('puts the latest changed first, an album with no date last', () => {
    const albums = [
      { ...KID_A, modifiedAt: '2026-01-01T00:00:00Z' },
      BLUE,
      { ...AMNESIAC, modifiedAt: '2026-05-01T00:00:00Z' },
    ]
    expect(idsOf(sortedAlbums({ albums, order: { sort: MUSIC_SORTS.modified, seed: 0 } }))).toEqual(
      [3, 1, 2],
    )
  })

  it('deals a random order by its seed, the same each time for one seed', () => {
    expect(orderedBy(MUSIC_SORTS.random, 7)).toEqual(orderedBy(MUSIC_SORTS.random, 7))
    expect(orderedBy(MUSIC_SORTS.random, 7).toSorted()).toEqual([1, 2, 3])
  })

  it('starts by title, and deals a new seed for each pick', () => {
    expect(FIRST_LIST_ORDER.sort).toBe(MUSIC_SORTS.title)
    expect(listOrderOf(MUSIC_SORTS.random).sort).toBe(MUSIC_SORTS.random)
  })

  it('leaves the list it was given as it was', () => {
    sortedAlbums({ albums: ALBUMS, order: FIRST_LIST_ORDER })
    expect(idsOf(ALBUMS)).toEqual([1, 2, 3])
  })
})

describe('matchingAlbums', () => {
  it('finds albums by title or artist, ignoring case, and keeps them all for nothing typed', () => {
    expect(idsOf(matchingAlbums({ albums: ALBUMS, query: 'radio' }))).toEqual([1, 3])
    expect(idsOf(matchingAlbums({ albums: ALBUMS, query: 'BLUE' }))).toEqual([2])
    expect(matchingAlbums({ albums: ALBUMS, query: '' })).toBe(ALBUMS)
  })
})

describe('matchingArtists', () => {
  type ArtistForProps = { id: number; name: string }

  const artistFor = ({ id, name }: ArtistForProps): Artist => ({
    id,
    name,
    sortName: name,
    mbid: null,
    photoVersion: null,
    albumCount: 1,
    trackCount: 3,
  })

  const ARTISTS = [artistFor({ id: 1, name: 'Radiohead' }), artistFor({ id: 2, name: 'Sia' })]

  it('finds artists by name, ignoring case, and keeps them all for nothing typed', () => {
    expect(matchingArtists({ artists: ARTISTS, query: 'RADIO' }).map(({ id }) => id)).toEqual([1])
    expect(matchingArtists({ artists: ARTISTS, query: 'beck' })).toEqual([])
    expect(matchingArtists({ artists: ARTISTS, query: '' })).toBe(ARTISTS)
  })
})

describe('recentAlbums', () => {
  it('keeps the newest added, newest first', () => {
    expect(idsOf(recentAlbums({ albums: ALBUMS, sort: RECENT_SORTS.added, limit: 2 }))).toEqual([
      2, 3,
    ])
  })

  it('keeps the latest releases, by date over year, an undated one last', () => {
    const undated = { ...BLUE, id: 9, year: null }
    const dated = { ...KID_A, id: 8, releaseDate: '2000-10-02' }
    const albums = [undated, KID_A, BLUE, dated, AMNESIAC]
    const latest = recentAlbums({ albums, sort: RECENT_SORTS.release, limit: 10 })
    expect(idsOf(latest).at(-1)).toBe(undated.id)
    expect(idsOf(latest).indexOf(dated.id)).toBeLessThan(idsOf(latest).indexOf(KID_A.id))
    expect(idsOf(latest).indexOf(KID_A.id)).toBeLessThan(idsOf(latest).indexOf(BLUE.id))
  })

  it('asks the server for the order it shows', () => {
    expect(RECENT_SERVER_SORTS).toEqual({
      [RECENT_SORTS.added]: MUSIC_SORTS.added,
      [RECENT_SORTS.release]: MUSIC_SORTS.release,
    })
  })
})

describe('openingAlbumsOrderOf', () => {
  it('opens Albums in the order Home was showing', () => {
    expect(openingAlbumsOrderOf(RECENT_SORTS.added)).toEqual({ sort: MUSIC_SORTS.added, seed: 0 })
    expect(openingAlbumsOrderOf(RECENT_SORTS.release)).toEqual({
      sort: MUSIC_SORTS.release,
      seed: 0,
    })
  })

  it('opens Albums by title when no order or an unknown one is named', () => {
    expect(openingAlbumsOrderOf(undefined)).toEqual(FIRST_LIST_ORDER)
    expect(openingAlbumsOrderOf('plays')).toEqual(FIRST_LIST_ORDER)
  })
})
