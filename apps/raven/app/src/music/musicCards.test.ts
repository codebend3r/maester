import { describe, expect, it } from 'bun:test'
import { type AlbumSummary, createApiClient } from '@raven/core'

import {
  albumCard,
  albumSectionsOf,
  artistCard,
  artistListSectionsOf,
  playlistCard,
  playlistSectionsOf,
  artistSectionsOf,
  trackCoverOf,
} from '@/music/musicCards'
import { CARD_SHAPES } from '@/queries/cards'
import { ROUTE_TARGETS } from '@/routes'
import { AIRBAG, MIXTAPE, PORTISHEAD, RADIOHEAD } from '@/test/musicServer'

const api = createApiClient({ fetch: () => new Promise(() => undefined) })
const headersFor = () => ({ cookie: 'raven_unlock=1' })

const ALBUM: AlbumSummary = {
  id: 7,
  libraryId: 1,
  title: 'OK Computer',
  sortTitle: 'OK Computer',
  year: 1997,
  type: 'album',
  artists: [
    { id: 1, name: 'Radiohead' },
    { id: 2, name: 'Guest' },
  ],
  isCompilation: false,
  trackCount: 12,
  duration: 3200,
  coverVersion: 'v1',
  addedAt: '2026-01-01T00:00:00Z',
  match: 'matched',
}

describe('musicCards', () => {
  it('draws an album as its cover under its artists, opening its page', () => {
    const card = albumCard({ api, headersFor, album: ALBUM })
    expect(card).toMatchObject({
      key: 'album:7',
      title: 'OK Computer',
      line: 'Radiohead, Guest',
      shape: CARD_SHAPES.poster,
      target: { kind: ROUTE_TARGETS.album, albumId: 7 },
    })
    expect(card.picture?.headers ?? null).toEqual({ cookie: 'raven_unlock=1' })
  })

  it('draws an album with no cover with no picture', () => {
    expect(
      albumCard({ api, headersFor, album: { ...ALBUM, coverVersion: null } }).picture,
    ).toBeNull()
  })

  it('lays a library out as one open run of albums, and none when it has none', () => {
    const [section] = albumSectionsOf({ api, headersFor, albums: [ALBUM] })
    expect(section?.title ?? null).toBeNull()
    expect(section?.cards.map((card) => card.key) ?? null).toEqual(['album:7'])
    expect(albumSectionsOf({ api, headersFor, albums: [] })).toEqual([])
  })

  it('lays an artist out as their albums open, then the albums they appear on as a bucket', () => {
    const sections = artistSectionsOf({
      api,
      headersFor,
      albums: [ALBUM],
      appearsOn: [{ ...ALBUM, id: 8 }],
    })
    expect(sections.map(({ title, count }) => [title, count])).toEqual([
      [null, null],
      ['Appears on', '1'],
    ])
    expect(artistSectionsOf({ api, headersFor, albums: [ALBUM], appearsOn: [] })).toHaveLength(1)
  })

  it('draws an artist as a row of their name and how much of the library is theirs', () => {
    expect(artistCard({ artist: RADIOHEAD })).toMatchObject({
      key: 'artist:1',
      title: 'Radiohead',
      line: '1 album · 3 tracks',
      picture: null,
      target: { kind: ROUTE_TARGETS.artist, artistId: 1 },
    })
    expect(artistCard({ artist: PORTISHEAD }).line).toBe('2 albums · 1 track')
  })

  it('lays the artists out as one run of rows, and none when there are none', () => {
    const [section] = artistListSectionsOf([PORTISHEAD, RADIOHEAD])
    expect(section?.cards.map((card) => card.key) ?? null).toEqual(['artist:2', 'artist:1'])
    expect(artistListSectionsOf([])).toEqual([])
  })

  it("draws a track's album cover with the server's cookies, and none while it has none", () => {
    expect(trackCoverOf({ api, headersFor, track: AIRBAG })).toBeNull()
    const cover = trackCoverOf({
      api,
      headersFor,
      track: { ...AIRBAG, album: { ...AIRBAG.album, coverVersion: 'v1' } },
    })
    expect(cover?.headers ?? null).toEqual({ cookie: 'raven_unlock=1' })
  })

  it('draws a playlist as a row of its name and facts, opening its page', () => {
    expect(playlistCard({ playlist: MIXTAPE })).toMatchObject({
      key: 'playlist:4',
      title: 'Mixtape',
      line: '3 tracks · 15 min',
      picture: null,
      target: { kind: ROUTE_TARGETS.playlist, playlistId: 4 },
    })
    expect(playlistSectionsOf([MIXTAPE])[0]?.cards ?? null).toHaveLength(1)
    expect(playlistSectionsOf([])).toEqual([])
  })
})
