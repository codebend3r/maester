import { describe, expect, it } from 'bun:test'
import { HOME_SHELF_TYPES, ITEM_TYPES, LIBRARY_KINDS, THUMBNAIL_STATES } from '@raven/core'

import { CARD_SHAPES } from '@/queries/cards'
import { CONTINUE_WATCHING, homeShelvesOf, libraryShelvesOf } from '@/queries/homeShelves'
import { FILMS, HOME, NAS, SERIES, homeApi } from '@/test/homeServer'
import { mediaItemFor } from '@/test/mediaItem'
import { ROUTE_TARGETS } from '@/routes'

const COOKIE = { Cookie: 'raven_unlock=u.1' }
const headersFor = () => COOKIE

describe('homeShelvesOf', () => {
  it('puts Continue watching first, then each library shelf under its name', () => {
    const shelves = homeShelvesOf({
      home: HOME,
      libraries: [FILMS, SERIES],
      api: homeApi(),
      headersFor,
    })
    expect(shelves.map(({ title }) => title)).toEqual([CONTINUE_WATCHING, 'Films', 'Series'])
    expect(shelves.map(({ cards }) => cards.map(({ title }) => title))).toEqual([
      ['Busboys'],
      ['Busboys', 'Night Train'],
      ['Severance'],
    ])
  })

  it('names the library each library shelf opens, and none for Continue watching', () => {
    const shelves = homeShelvesOf({
      home: HOME,
      libraries: [FILMS, SERIES],
      api: homeApi(),
      headersFor,
    })
    expect(shelves.map(({ libraryId }) => libraryId)).toEqual([null, FILMS.id, SERIES.id])
  })

  it('shows Continue watching wide, on the backdrop, with how far in it is', () => {
    const [continuing] = homeShelvesOf({
      home: HOME,
      libraries: [FILMS, SERIES],
      api: homeApi(),
      headersFor,
    })
    expect(continuing?.cards[0] ?? null).toEqual({
      key: 'media:20',
      title: 'Busboys',
      line: '2026',
      shape: CARD_SHAPES.wide,
      picture: { uri: `${NAS.origin}/api/pictures/items/40/backdrop/b40`, headers: COOKIE },
      progress: 0.25,
      target: { kind: ROUTE_TARGETS.item, itemId: 40, libraryId: FILMS.id, fileId: null },
    })
  })

  it("shows a movie library's and a show library's cards as posters", () => {
    const [, films, series] = homeShelvesOf({
      home: HOME,
      libraries: [FILMS, SERIES],
      api: homeApi(),
      headersFor,
    })
    expect(films?.cards[1] ?? null).toEqual({
      key: 'media:21',
      title: 'Night Train',
      line: '2025',
      shape: CARD_SHAPES.poster,
      picture: { uri: `${NAS.origin}/api/pictures/items/41/poster/p41`, headers: COOKIE },
      progress: 0,
      target: { kind: ROUTE_TARGETS.item, itemId: 41, libraryId: FILMS.id, fileId: null },
    })
    expect(series?.cards[0] ?? null).toEqual({
      key: 'show:4',
      title: 'Severance',
      line: '2022 to now',
      shape: CARD_SHAPES.poster,
      picture: { uri: `${NAS.origin}/api/pictures/items/4/poster/p4`, headers: COOKIE },
      progress: 0,
      target: { kind: ROUTE_TARGETS.item, itemId: 4, libraryId: null, fileId: null },
    })
  })

  it('shows any other library as frame grabs, and a card with no picture as none', () => {
    const clips = { ...FILMS, id: 3, settings: { ...FILMS.settings, kind: LIBRARY_KINDS.other } }
    const [shelf] = homeShelvesOf({
      home: {
        inProgress: [],
        shelves: [
          {
            libraryId: clips.id,
            type: HOME_SHELF_TYPES.media,
            media: [
              mediaItemFor({ id: 30, title: 'Beach', duration: 95, thumbnailVersion: 3 }),
              mediaItemFor({
                id: 31,
                title: 'Bare',
                duration: null,
                thumbnail: THUMBNAIL_STATES.pending,
              }),
            ],
          },
        ],
      },
      libraries: [clips],
      api: homeApi(),
      headersFor,
    })
    expect(
      (shelf?.cards ?? []).map(({ shape, picture, line, target }) => ({
        shape,
        picture,
        line,
        target,
      })),
    ).toEqual([
      {
        shape: CARD_SHAPES.wide,
        picture: { uri: `${NAS.origin}/api/media/30/thumbnail?v=3`, headers: COOKIE },
        line: '2m',
        target: { kind: ROUTE_TARGETS.play, mediaId: 30 },
      },
      {
        shape: CARD_SHAPES.wide,
        picture: null,
        line: null,
        target: { kind: ROUTE_TARGETS.play, mediaId: 31 },
      },
    ])
  })

  it('names an episode in progress by its show, and shows its own frame', () => {
    const episode = mediaItemFor({
      id: 50,
      position: 60,
      duration: 600,
      thumbnailVersion: 2,
      item: {
        id: 60,
        type: ITEM_TYPES.episode,
        title: 'Half Loop',
        year: 2022,
        show: { id: 4, title: 'Severance' },
        season: 1,
        episode: 2,
        posterVersion: null,
        backdropVersion: null,
        ratings: [],
      },
    })
    const [shelf] = homeShelvesOf({
      home: { inProgress: [{ media: episode, poster: null }], shelves: [] },
      libraries: [],
      api: homeApi(),
      headersFor,
    })
    expect(shelf?.cards[0] ?? null).toMatchObject({
      title: 'Severance',
      line: 'S01E02 · Half Loop',
      picture: { uri: `${NAS.origin}/api/media/50/thumbnail?v=2` },
      target: { kind: ROUTE_TARGETS.item, itemId: 60, libraryId: 1, fileId: null },
    })
  })

  it('leaves out a shelf for a library not in the list, and an empty Continue watching', () => {
    const shelves = homeShelvesOf({
      home: { ...HOME, inProgress: [] },
      libraries: [SERIES],
      api: homeApi(),
      headersFor,
    })
    expect(shelves.map(({ title }) => title)).toEqual(['Series'])
  })
})

describe('libraryShelvesOf', () => {
  it('lays out what a search found as library shelves, leaving out a library not listed', () => {
    const shelves = libraryShelvesOf({
      shelves: [...HOME.shelves, { libraryId: 9, type: HOME_SHELF_TYPES.media, media: [] }],
      libraries: [FILMS, SERIES],
      api: homeApi(),
      headersFor,
    })
    expect(shelves.map(({ key, title, libraryId }) => ({ key, title, libraryId }))).toEqual([
      { key: `library:${FILMS.id}`, title: 'Films', libraryId: FILMS.id },
      { key: `library:${SERIES.id}`, title: 'Series', libraryId: SERIES.id },
    ])
    expect(shelves.map(({ cards }) => cards.map(({ title }) => title))).toEqual([
      ['Busboys', 'Night Train'],
      ['Severance'],
    ])
  })
})
