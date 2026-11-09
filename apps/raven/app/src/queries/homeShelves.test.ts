import { describe, expect, it } from 'bun:test'
import {
  AUTH_HEADERS,
  HOME_SHELF_TYPES,
  ITEM_TYPES,
  LIBRARY_KINDS,
  THUMBNAIL_STATES,
} from '@raven/core'

import { CARD_SHAPES, CARD_SUBJECTS } from '@/queries/cards'
import {
  CONTINUE_WATCHING,
  HOME_CONTINUE_COUNT,
  HOME_ROW_TYPES,
  SHELF_LAYOUTS,
  homeRowsOf,
  homeShelvesOf,
  libraryShelvesOf,
} from '@/queries/homeShelves'
import type { ShowArts } from '@/queries/showArt'
import { FILMS, HOME, NAS, SERIES, homeApi } from '@/test/homeServer'
import { OK_COMPUTER } from '@/test/musicServer'
import { mediaItemFor, summaryFor } from '@/test/mediaItem'
import { ROUTE_TARGETS } from '@/routes'

const COOKIE = { [AUTH_HEADERS.cookie]: 'raven_unlock=u.1' }
const headersFor = () => COOKIE

/** No art read yet. */
const NO_ARTS: ShowArts = new Map()

describe('homeShelvesOf', () => {
  it('puts Continue watching first, then each library shelf under its name', () => {
    const shelves = homeShelvesOf({
      arts: NO_ARTS,
      albumShelves: [],
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
      arts: NO_ARTS,
      albumShelves: [],
      home: HOME,
      libraries: [FILMS, SERIES],
      api: homeApi(),
      headersFor,
    })
    expect(shelves.map(({ libraryId }) => libraryId)).toEqual([null, FILMS.id, SERIES.id])
  })

  it('shows Continue watching wide, on the backdrop, with how far in it is', () => {
    const [continuing] = homeShelvesOf({
      arts: NO_ARTS,
      albumShelves: [],
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
      subject: { kind: CARD_SUBJECTS.video, mediaId: 20 },
      isWatched: false,
      target: { kind: ROUTE_TARGETS.item, itemId: 40, libraryId: FILMS.id, fileId: null },
      logo: null,
      episode: null,
      resume: { timeLeft: '1h 15m left' },
    })
  })

  it("shows a movie library's and a show library's cards as posters", () => {
    const [, films, series] = homeShelvesOf({
      arts: NO_ARTS,
      albumShelves: [],
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
      subject: { kind: CARD_SUBJECTS.video, mediaId: 21 },
      isWatched: false,
      target: { kind: ROUTE_TARGETS.item, itemId: 41, libraryId: FILMS.id, fileId: null },
    })
    expect(series?.cards[0] ?? null).toEqual({
      key: 'show:4',
      title: 'Severance',
      line: '2022 to now',
      shape: CARD_SHAPES.poster,
      picture: { uri: `${NAS.origin}/api/pictures/items/4/poster/p4`, headers: COOKIE },
      progress: 0,
      subject: { kind: CARD_SUBJECTS.item, itemId: 4 },
      isWatched: false,
      target: { kind: ROUTE_TARGETS.item, itemId: 4, libraryId: null, fileId: null },
    })
  })

  it('shows any other library as frame grabs, and a card with no picture as none', () => {
    const clips = { ...FILMS, id: 3, settings: { ...FILMS.settings, kind: LIBRARY_KINDS.other } }
    const [shelf] = homeShelvesOf({
      arts: NO_ARTS,
      albumShelves: [],
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
        target: { kind: ROUTE_TARGETS.play, mediaId: 30, at: 0 },
      },
      {
        shape: CARD_SHAPES.wide,
        picture: null,
        line: null,
        target: { kind: ROUTE_TARGETS.play, mediaId: 31, at: 0 },
      },
    ])
  })

  it("wears the show's title art and backdrop on an episode whose poster is its season", () => {
    const show = summaryFor({ id: 4, type: ITEM_TYPES.show, title: "The Handmaid's Tale" })
    const season = summaryFor({
      id: 5,
      type: ITEM_TYPES.season,
      title: 'Season 5',
      show: { id: show.id, title: show.title },
      season: 5,
      backdropVersion: null,
    })
    const episode = mediaItemFor({
      id: 50,
      position: 600,
      duration: 3000,
      thumbnailVersion: 2,
      item: summaryFor({
        id: 60,
        type: ITEM_TYPES.episode,
        title: 'Morning',
        show: { id: show.id, title: show.title },
        season: 5,
        episode: 1,
        backdropVersion: null,
      }),
    })
    const logo = { uri: `${NAS.origin}/api/pictures/items/4/logo/l4`, headers: COOKIE }
    const backdrop = { uri: `${NAS.origin}/api/pictures/items/4/backdrop/b4`, headers: COOKIE }
    const [shelf] = homeShelvesOf({
      arts: new Map([[show.id, { logo, backdrop }]]),
      home: { inProgress: [{ media: episode, poster: season }], shelves: [] },
      libraries: [],
      albumShelves: [],
      api: homeApi(),
      headersFor,
    })
    expect(shelf?.cards[0] ?? null).toMatchObject({
      title: "The Handmaid's Tale",
      line: null,
      picture: backdrop,
      logo,
      episode: { name: 'Morning', mark: 'S5.E1' },
      resume: { timeLeft: '40m left' },
    })
  })

  it('names an episode in progress by its show, and shows its own frame when the show has no art', () => {
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
        released: null,
      },
    })
    const [shelf] = homeShelvesOf({
      arts: NO_ARTS,
      albumShelves: [],
      home: { inProgress: [{ media: episode, poster: null }], shelves: [] },
      libraries: [],
      api: homeApi(),
      headersFor,
    })
    expect(shelf?.cards[0] ?? null).toMatchObject({
      title: 'Severance',
      line: null,
      episode: { name: 'Half Loop', mark: 'S1.E2' },
      picture: { uri: `${NAS.origin}/api/media/50/thumbnail?v=2` },
      target: { kind: ROUTE_TARGETS.item, itemId: 60, libraryId: 1, fileId: null },
    })
  })

  it('lays Continue watching out as a grid of its newest six, and says when it holds more', () => {
    const [entry] = HOME.inProgress
    if (entry === undefined) throw new Error('No video in progress')
    const many = Array.from({ length: HOME_CONTINUE_COUNT + 2 }, (_, index) => ({
      ...entry,
      media: { ...entry.media, id: 900 + index },
    }))
    const shelves = homeShelvesOf({
      arts: NO_ARTS,
      albumShelves: [],
      home: { ...HOME, inProgress: many },
      libraries: [FILMS, SERIES],
      api: homeApi(),
      headersFor,
    })
    expect(
      shelves.map(({ layout, hasMore, cards }) => ({ layout, hasMore, count: cards.length })),
    ).toEqual([
      { layout: SHELF_LAYOUTS.grid, hasMore: true, count: HOME_CONTINUE_COUNT },
      { layout: SHELF_LAYOUTS.row, hasMore: false, count: 2 },
      { layout: SHELF_LAYOUTS.row, hasMore: false, count: 1 },
    ])
  })

  it('says Continue watching holds no more when it shows them all', () => {
    const [continuing] = homeShelvesOf({
      arts: NO_ARTS,
      albumShelves: [],
      home: HOME,
      libraries: [FILMS, SERIES],
      api: homeApi(),
      headersFor,
    })
    expect(continuing?.hasMore ?? null).toBe(false)
  })

  it('leaves out a shelf for a library not in the list, and an empty Continue watching', () => {
    const shelves = homeShelvesOf({
      arts: NO_ARTS,
      albumShelves: [],
      home: { ...HOME, inProgress: [] },
      libraries: [SERIES],
      api: homeApi(),
      headersFor,
    })
    expect(shelves.map(({ title }) => title)).toEqual(['Series'])
  })
})

describe('homeRowsOf', () => {
  it("puts a music library's albums in its row, and leaves every other shelf as it is", () => {
    const albums = [{ ...OK_COMPUTER, id: 2 }]
    const rows = homeRowsOf({
      shelves: [...HOME.shelves, { libraryId: 7, type: HOME_SHELF_TYPES.media, media: [] }],
      albumShelves: [{ libraryId: 7, albums }],
    })
    expect(rows.map(({ libraryId, type }) => ({ libraryId, type }))).toEqual([
      { libraryId: FILMS.id, type: HOME_ROW_TYPES.media },
      { libraryId: SERIES.id, type: HOME_ROW_TYPES.shows },
      { libraryId: 7, type: HOME_ROW_TYPES.albums },
    ])
    expect(rows[2]).toEqual({ libraryId: 7, type: HOME_ROW_TYPES.albums, albums })
  })

  it('keeps a shelf of shows even where albums were read for its library', () => {
    const rows = homeRowsOf({
      shelves: HOME.shelves,
      albumShelves: [{ libraryId: SERIES.id, albums: [OK_COMPUTER] }],
    })
    expect(rows.map(({ type }) => type)).toEqual([HOME_ROW_TYPES.media, HOME_ROW_TYPES.shows])
  })
})

describe('libraryShelvesOf', () => {
  it("shows a music library's row as its albums, square covers in the server's order", () => {
    const [shelf] = libraryShelvesOf({
      rows: homeRowsOf({
        shelves: [{ libraryId: FILMS.id, type: HOME_SHELF_TYPES.media, media: [] }],
        albumShelves: [
          {
            libraryId: FILMS.id,
            albums: [
              { ...OK_COMPUTER, id: 2, title: 'Newest', coverVersion: 'v1' },
              { ...OK_COMPUTER, id: 1, title: 'Older' },
            ],
          },
        ],
      }),
      libraries: [FILMS],
      api: homeApi(),
      headersFor,
    })
    expect(shelf?.cards.map(({ key, title, shape }) => ({ key, title, shape }))).toEqual([
      { key: 'album:2', title: 'Newest', shape: CARD_SHAPES.square },
      { key: 'album:1', title: 'Older', shape: CARD_SHAPES.square },
    ])
    expect(shelf?.cards[0]?.picture?.uri).toContain('/albums/2')
  })

  it('lays out what a search found as library shelves, leaving out a library not listed', () => {
    const shelves = libraryShelvesOf({
      rows: [...HOME.shelves, { libraryId: 9, type: HOME_SHELF_TYPES.media, media: [] }],
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
