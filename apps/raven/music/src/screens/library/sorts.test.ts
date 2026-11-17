import { describe, expect, it } from 'bun:test'
import { ALBUM_TYPES, type AlbumSummary, MATCH_STATES, MUSIC_SORTS } from '@raven/core'

import {
  LIST_SORTS,
  LIST_SORT_ORDER,
  SERVER_SORTS,
  matchingAlbums,
  newestAlbums,
  sortedAlbums,
} from '@/screens/library/sorts'

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
    expect(idsOf(matchingAlbums({ albums: ALBUMS, query: ' BLUE ' }))).toEqual([2])
    expect(matchingAlbums({ albums: ALBUMS, query: '' })).toBe(ALBUMS)
  })
})

describe('newestAlbums', () => {
  it('keeps the newest added, newest first', () => {
    expect(idsOf(newestAlbums({ albums: ALBUMS, limit: 2 }))).toEqual([2, 3])
  })
})

describe('the sorts', () => {
  it("lists every sort, each with the server's own", () => {
    expect(LIST_SORT_ORDER).toEqual(['title', 'artist', 'year', 'added'])
    expect(SERVER_SORTS[LIST_SORTS.added]).toBe(MUSIC_SORTS.added)
  })
})
