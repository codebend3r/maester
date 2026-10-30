import { describe, expect, it } from 'bun:test'
import { type AlbumSummary, createApiClient } from '@raven/core'

import { albumCard, albumSectionsOf, artistSectionsOf } from '@/music/musicCards'
import { CARD_SHAPES } from '@/queries/cards'
import { ROUTE_TARGETS } from '@/routes'

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
    expect(card.picture?.headers).toEqual({ cookie: 'raven_unlock=1' })
  })

  it('draws an album with no cover with no picture', () => {
    expect(
      albumCard({ api, headersFor, album: { ...ALBUM, coverVersion: null } }).picture,
    ).toBeNull()
  })

  it('lays a library out as one open run of albums, and none when it has none', () => {
    const [section] = albumSectionsOf({ api, headersFor, albums: [ALBUM] })
    expect(section?.title).toBeNull()
    expect(section?.cards.map((card) => card.key)).toEqual(['album:7'])
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
})
