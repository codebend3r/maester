import { describe, expect, it } from 'bun:test'
import { ITEM_TYPES, SESSION_KINDS } from '@/contract'
import {
  CARD_DESTINATIONS,
  cardDestination,
  cardLink,
  episodeBackPath,
  inLibrary,
  itemPath,
  libraryFiles,
  queryId,
  queueLink,
  readWatchState,
  sessionOf,
  watchLink,
  PAGE_PATHS,
  watchPageOf,
} from '@/itemLinks'
import { itemSummary, mediaItem } from '@/test/fixtures'

describe('itemPath', () => {
  it("puts a season's page under its show", () => {
    expect(
      itemPath(itemSummary({ type: ITEM_TYPES.season, show: { id: 5, title: 'X' }, season: 2 })),
    ).toBe('/shows/5/seasons/2')
    expect(itemPath(itemSummary({ type: ITEM_TYPES.season, show: null, season: 2 }))).toBeNull()
  })
})

describe('episodeBackPath', () => {
  it('leads to the season, else the show, else the library', () => {
    const show = { id: 5, title: 'Severance' }
    expect(episodeBackPath({ item: itemSummary({ show, season: 1 }), libraryId: 3 })).toBe(
      '/shows/5/seasons/1',
    )
    expect(episodeBackPath({ item: itemSummary({ show, season: null }), libraryId: 3 })).toBe(
      '/shows/5',
    )
    expect(episodeBackPath({ item: itemSummary({ show: null }), libraryId: 3 })).toBe(
      '/libraries/3',
    )
  })
})

describe('watchPageOf', () => {
  it("names a video's page under the watch path", () => {
    expect(PAGE_PATHS).toEqual({
      settings: '/settings',
      shortcuts: '/shortcuts',
      watch: '/watch',
    })
    expect(watchPageOf(9)).toBe('/watch/9')
  })
})

describe('sessionOf', () => {
  it('rolls an episode on through its show, and plays anything else on its own', () => {
    const episode = itemSummary({ type: ITEM_TYPES.episode })
    expect(sessionOf(mediaItem({ item: episode }))).toEqual({ kind: SESSION_KINDS.show })
    const movie = itemSummary({ type: ITEM_TYPES.movie })
    expect(sessionOf(mediaItem({ item: movie }))).toEqual({ kind: SESSION_KINDS.single })
    expect(sessionOf(mediaItem({ item: null }))).toEqual({ kind: SESSION_KINDS.single })
  })
})

describe('watchLink', () => {
  it('hands the video over in router state, in its own session when the page names none', () => {
    const media = mediaItem({ id: 9, item: itemSummary({ type: ITEM_TYPES.episode }) })
    expect(watchLink({ media })).toEqual({
      to: '/watch/9',
      state: { media, session: { kind: SESSION_KINDS.show }, upNext: [] },
    })
  })

  it('hands over the session a page names', () => {
    const media = mediaItem({ id: 9 })
    const session = { kind: SESSION_KINDS.saga, sagaId: '10' } as const
    expect(watchLink({ media, session }).state.session).toEqual(session)
  })
})

describe('queueLink', () => {
  it('plays the first of a shuffled queue, with the rest after it', () => {
    const first = mediaItem({ id: 9 })
    const rest = [mediaItem({ id: 10 }), mediaItem({ id: 11 })]
    expect(queueLink({ queue: [first, ...rest] })).toEqual({
      to: '/watch/9',
      state: { media: first, session: { kind: SESSION_KINDS.queue }, upNext: rest },
    })
  })

  it('has nothing to play from an empty queue', () => {
    expect(queueLink({ queue: [] })).toBeNull()
  })
})

describe('readWatchState', () => {
  it("reads what a link handed over for the video it plays, and nothing for another's", () => {
    const { state } = queueLink({ queue: [mediaItem({ id: 9 }), mediaItem({ id: 10 })] }) ?? {}
    expect(readWatchState({ state, id: 9 })).toEqual(state ?? null)
    expect(readWatchState({ state, id: 10 })).toBeNull()
  })

  it('reads nothing from a direct visit, or state from before sessions', () => {
    expect(readWatchState({ state: null, id: 9 })).toBeNull()
    expect(readWatchState({ state: { media: mediaItem({ id: 9 }) }, id: 9 })).toBeNull()
    expect(
      readWatchState({
        state: { media: mediaItem({ id: 9 }), upNext: [], isShuffled: false },
        id: 9,
      }),
    ).toBeNull()
  })
})

describe('cardLink', () => {
  it("opens a matched movie's page, naming the file when the movie was split onto several cards", () => {
    const item = itemSummary({ id: 4, type: ITEM_TYPES.movie })
    expect(cardLink({ media: mediaItem({ id: 9, libraryId: 2, item }), hasPages: true })).toEqual({
      to: '/movies/4?library=2',
    })
    expect(
      cardLink({
        media: mediaItem({ id: 9, libraryId: 2, item, variant: 'Final Cut' }),
        hasPages: true,
      }),
    ).toEqual({ to: '/movies/4?library=2&file=9' })
  })

  it("opens the page as the card's own library shows it", () => {
    const media = mediaItem({
      id: 9,
      libraryId: 5,
      item: itemSummary({ id: 4, type: ITEM_TYPES.movie }),
    })
    expect(cardLink({ media, hasPages: true })).toEqual({ to: '/movies/4?library=5' })
  })

  it('plays a file straight away where the library has no pages', () => {
    const media = mediaItem({ id: 9, item: itemSummary({ id: 4, type: ITEM_TYPES.movie }) })
    expect(cardLink({ media, hasPages: false })).toEqual(watchLink({ media }))
  })
})

describe('cardDestination', () => {
  it("goes to a matched video's page in its library, naming the file of a split card", () => {
    const item = itemSummary({ id: 4, type: ITEM_TYPES.movie })
    expect(
      cardDestination({ media: mediaItem({ id: 9, libraryId: 2, item }), hasPages: true }),
    ).toEqual({
      kind: CARD_DESTINATIONS.page,
      item,
      path: '/movies/4',
      libraryId: 2,
      file: null,
    })
    expect(
      cardDestination({
        media: mediaItem({ id: 9, libraryId: 2, item, variant: 'Final Cut' }),
        hasPages: true,
      }),
    ).toMatchObject({ kind: CARD_DESTINATIONS.page, file: 9 })
  })

  it('goes to the player for a file matched to nothing, an item with no page, or a library with no pages', () => {
    const unmatched = mediaItem({ id: 3 })
    expect(cardDestination({ media: unmatched, hasPages: true })).toEqual({
      kind: CARD_DESTINATIONS.player,
      media: unmatched,
    })
    const loose = mediaItem({ item: itemSummary({ type: ITEM_TYPES.season, show: null }) })
    expect(cardDestination({ media: loose, hasPages: true }).kind).toBe(CARD_DESTINATIONS.player)
    const movie = mediaItem({ item: itemSummary({ type: ITEM_TYPES.movie }) })
    expect(cardDestination({ media: movie, hasPages: false }).kind).toBe(CARD_DESTINATIONS.player)
  })
})

describe('inLibrary', () => {
  it('names the library, and the file Play starts where there is one', () => {
    expect(inLibrary({ page: '/movies/4', libraryId: 3 })).toBe('/movies/4?library=3')
    expect(inLibrary({ page: '/movies/4', libraryId: 3, file: 9 })).toBe(
      '/movies/4?library=3&file=9',
    )
  })

  it('escapes what a number prints that an address cannot carry, as URLSearchParams did', () => {
    expect(inLibrary({ page: '/movies/4', libraryId: 1e21 })).toBe('/movies/4?library=1e%2B21')
    expect(inLibrary({ page: '/movies/4', libraryId: -3, file: 1e21 })).toBe(
      '/movies/4?library=-3&file=1e%2B21',
    )
    expect(inLibrary({ page: '/movies/4', libraryId: Number.NaN, file: 0.5 })).toBe(
      '/movies/4?library=NaN&file=0.5',
    )
    expect(inLibrary({ page: '/movies/4', libraryId: 3, file: 0 })).toBe(
      '/movies/4?library=3&file=0',
    )
  })

  it('escapes the same through a card link', () => {
    const media = mediaItem({
      id: 1e21,
      libraryId: 1e21,
      variant: 'Final Cut',
      item: itemSummary({ id: 4, type: ITEM_TYPES.movie }),
    })
    expect(cardLink({ media, hasPages: true })).toEqual({
      to: '/movies/4?library=1e%2B21&file=1e%2B21',
    })
  })
})

describe('queryId', () => {
  it('reads a whole number, and nothing else', () => {
    expect(queryId('12')).toBe(12)
    expect(queryId(null)).toBeNull()
    expect(queryId('')).toBeNull()
    expect(queryId('1.5')).toBeNull()
    expect(queryId('four')).toBeNull()
  })
})

describe('libraryFiles', () => {
  const uhd = mediaItem({ id: 8, libraryId: 2 })
  const uhdToo = mediaItem({ id: 6, libraryId: 2 })
  const hd = mediaItem({ id: 7, libraryId: 3 })
  const versions = [uhd, uhdToo, hd]

  it("keeps to the library named, starting the file named where it is that library's", () => {
    expect(libraryFiles({ versions, library: 3, file: null })).toEqual({
      versions: [hd],
      everyCard: [hd],
      primary: hd,
    })
    expect(libraryFiles({ versions, library: 2, file: 6 })).toEqual({
      versions: [uhd, uhdToo],
      everyCard: [uhd, uhdToo],
      primary: uhdToo,
    })
    expect(libraryFiles({ versions, library: 2, file: 7 })).toEqual({
      versions: [uhd, uhdToo],
      everyCard: [uhd, uhdToo],
      primary: uhd,
    })
  })

  it("takes the named file's library, else the library of the file Play would start", () => {
    expect(libraryFiles({ versions, library: null, file: 7 })?.versions).toEqual([hd])
    expect(libraryFiles({ versions, library: 9, file: null })?.versions).toEqual([uhd, uhdToo])
    const resumed = mediaItem({ id: 7, libraryId: 3, position: 60 })
    expect(libraryFiles({ versions: [uhd, resumed], library: null, file: null })?.versions).toEqual(
      [resumed],
    )
  })

  it("keeps to one card of a split movie: the named file's, else the movie's own", () => {
    const own = mediaItem({ id: 1, libraryId: 2 })
    const ownToo = mediaItem({ id: 2, libraryId: 2 })
    const cut = mediaItem({ id: 3, libraryId: 2, card: 'cut:Final Cut', variant: 'Final Cut' })
    const split = [own, ownToo, cut]
    expect(libraryFiles({ versions: split, library: 2, file: 3 })).toEqual({
      versions: [cut],
      everyCard: split,
      primary: cut,
    })
    expect(libraryFiles({ versions: split, library: 2, file: null })?.versions).toEqual([
      own,
      ownToo,
    ])
  })

  it('takes the card of the file Play would start once every file has a card of its own', () => {
    const apart = [
      mediaItem({ id: 1, libraryId: 2, card: 'file:1', size: 1 }),
      mediaItem({ id: 2, libraryId: 2, card: 'file:2', size: 1, position: 60 }),
    ]
    expect(libraryFiles({ versions: apart, library: 2, file: null })?.versions).toEqual([apart[1]])
  })

  it('has nothing to show without files', () => {
    expect(libraryFiles({ versions: [], library: 2, file: null })).toBeNull()
  })
})
