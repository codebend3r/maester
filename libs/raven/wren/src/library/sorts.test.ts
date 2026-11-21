import { describe, expect, it } from 'bun:test'
import { ALBUM_TYPES, type AlbumSummary, type Artist, MATCH_STATES, MUSIC_SORTS } from '@raven/core'

import {
  LIST_SORTS,
  LIST_SORT_ORDER,
  SERVER_SORTS,
  RECENT_SERVER_SORTS,
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

describe('sortedAlbums', () => {
  it('puts albums by title, by artist then title, newest year first, or newest added first', () => {
    expect(idsOf(sortedAlbums({ albums: ALBUMS, sort: LIST_SORTS.title }))).toEqual([3, 2, 1])
    expect(idsOf(sortedAlbums({ albums: ALBUMS, sort: LIST_SORTS.artist }))).toEqual([2, 3, 1])
    expect(idsOf(sortedAlbums({ albums: ALBUMS, sort: LIST_SORTS.year }))).toEqual([1, 2, 3])
    expect(idsOf(sortedAlbums({ albums: ALBUMS, sort: LIST_SORTS.added }))).toEqual([2, 3, 1])
  })

  it('leaves the list it was given as it was', () => {
    sortedAlbums({ albums: ALBUMS, sort: LIST_SORTS.title })
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

describe('the sorts', () => {
  it("lists every sort, each with the server's own", () => {
    expect(LIST_SORT_ORDER).toEqual(['title', 'artist', 'year', 'added'])
    expect(SERVER_SORTS[LIST_SORTS.added]).toBe(MUSIC_SORTS.added)
  })
})
