import { describe, expect, it } from 'bun:test'
import { ALBUM_TYPES, type AlbumSummary, type Artist, MATCH_STATES } from '@raven/core'

import { SEARCH_COPY } from '@/copy/screens'
import {
  RECENT_KINDS,
  RECENT_SEARCHES_KEPT,
  type RecentSearch,
  mergedRecentsOf,
  recentKeyOf,
  recentOfAlbum,
  recentOfArtist,
  recentSearchesOf,
  recentTextOf,
  withRecent,
  withoutRecent,
} from '@/search/recentSearches'

const LOVE: RecentSearch = { kind: RECENT_KINDS.query, text: 'love' }
const SIA: RecentSearch = { kind: RECENT_KINDS.artist, id: 3, name: 'Sia' }
const DOO_WOPS: RecentSearch = {
  kind: RECENT_KINDS.album,
  id: 9,
  title: 'Doo-Wops & Hooligans',
  artists: 'Bruno Mars',
}

describe('withRecent', () => {
  it('puts the newest first and moves a search made again to the top', () => {
    const recents = withRecent({ recents: [SIA, LOVE], recent: DOO_WOPS })
    expect(recents).toEqual([DOO_WOPS, SIA, LOVE])
    expect(withRecent({ recents, recent: { ...LOVE, text: 'LOVE' } })).toEqual([
      { ...LOVE, text: 'LOVE' },
      DOO_WOPS,
      SIA,
    ])
  })

  it(`keeps at most ${RECENT_SEARCHES_KEPT}`, () => {
    const many = Array.from({ length: RECENT_SEARCHES_KEPT + 3 }, (_, id) => ({
      kind: RECENT_KINDS.artist,
      id,
      name: `Artist ${id}`,
    }))
    const recents = many.reduce<RecentSearch[]>(
      (kept, recent) => withRecent({ recents: kept, recent }),
      [],
    )
    expect(recents).toHaveLength(RECENT_SEARCHES_KEPT)
    expect(recents[0]).toEqual(many.at(-1) ?? SIA)
  })

  it('leaves the list as it was for a blank search', () => {
    expect(
      withRecent({ recents: [SIA, LOVE], recent: { kind: RECENT_KINDS.query, text: '  ' } }),
    ).toEqual([SIA, LOVE])
    expect(withRecent({ recents: [], recent: { kind: RECENT_KINDS.query, text: '' } })).toEqual([])
  })
})

describe('withoutRecent', () => {
  it('forgets the search of that key and keeps the rest in order', () => {
    const recents = [DOO_WOPS, SIA, LOVE]
    expect(withoutRecent({ recents, key: recentKeyOf(SIA) })).toEqual([DOO_WOPS, LOVE])
    expect(withoutRecent({ recents, key: 'artist:404' })).toEqual(recents)
  })
})

describe('mergedRecentsOf', () => {
  it('keeps what was searched before the saved list was read on top of it, each once', () => {
    expect(
      mergedRecentsOf({ current: [LOVE], saved: { recents: [SIA, LOVE, 'nonsense', DOO_WOPS] } }),
    ).toEqual([LOVE, SIA, DOO_WOPS])
    expect(mergedRecentsOf({ current: [LOVE], saved: undefined })).toEqual([LOVE])
  })
})

const BRUNO: Artist = {
  id: 4,
  name: 'Bruno Mars',
  sortName: 'Mars, Bruno',
  mbid: null,
  photoVersion: null,
  albumCount: 1,
  trackCount: 10,
}

const DOO_WOPS_ALBUM: AlbumSummary = {
  id: DOO_WOPS.id,
  libraryId: 5,
  title: DOO_WOPS.title,
  sortTitle: DOO_WOPS.title,
  releaseDate: null,
  year: 2010,
  type: ALBUM_TYPES.album,
  artists: [{ id: BRUNO.id, name: BRUNO.name }],
  isCompilation: false,
  trackCount: 10,
  duration: 2100,
  coverVersion: null,
  match: MATCH_STATES.matched,
  addedAt: '2026-01-01T00:00:00Z',
}

describe('recentOfAlbum and recentOfArtist', () => {
  it('remember an album by its id, title and artists, and an artist by its id and name', () => {
    expect(recentOfAlbum(DOO_WOPS_ALBUM)).toEqual(DOO_WOPS)
    expect(recentOfArtist(BRUNO)).toEqual({
      kind: RECENT_KINDS.artist,
      id: BRUNO.id,
      name: BRUNO.name,
    })
  })
})

describe('recentKeyOf', () => {
  it('names words whatever their case, and an artist or an album by its id', () => {
    expect(recentKeyOf({ ...LOVE, text: 'LOVE' })).toBe(recentKeyOf(LOVE))
    expect(recentKeyOf(SIA)).not.toBe(recentKeyOf({ ...DOO_WOPS, id: SIA.id }))
    expect(recentKeyOf({ ...SIA, name: 'SIA' })).toBe(recentKeyOf(SIA))
  })
})

describe('recentSearchesOf', () => {
  it('keeps what is a recent search and drops the rest', () => {
    expect(
      recentSearchesOf({
        recents: [LOVE, { kind: 'song', id: 1 }, { kind: RECENT_KINDS.album, id: 'x' }, SIA, 7],
      }),
    ).toEqual([LOVE, SIA])
    expect(recentSearchesOf(null)).toEqual([])
    expect(recentSearchesOf({ recents: 'love' })).toEqual([])
  })
})

describe('recentTextOf', () => {
  it('names a search, an artist or an album, and says which it was', () => {
    expect(recentTextOf(LOVE)).toEqual({ name: 'love', line: SEARCH_COPY.recentSearch })
    expect(recentTextOf(SIA)).toEqual({ name: 'Sia', line: SEARCH_COPY.recentArtist })
    expect(recentTextOf(DOO_WOPS)).toEqual({
      name: 'Doo-Wops & Hooligans',
      line: SEARCH_COPY.recentAlbum({ kind: SEARCH_COPY.album, artists: 'Bruno Mars' }),
    })
  })
})
