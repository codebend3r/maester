import { describe, expect, it } from 'bun:test'
import { cardLink, episodeBackPath, itemPath, readWatchState, watchLink } from '@/lib/itemLinks'
import { itemSummary, mediaItem } from '@/test/fixtures'

describe('itemPath', () => {
  it("puts a season's page under its show", () => {
    expect(itemPath(itemSummary({ type: 'season', show: { id: 5, title: 'X' }, season: 2 }))).toBe(
      '/shows/5/seasons/2',
    )
    expect(itemPath(itemSummary({ type: 'season', show: null, season: 2 }))).toBeNull()
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

describe('watchLink', () => {
  it('hands the video over in router state, with nothing to play after it', () => {
    const media = mediaItem({ id: 9 })
    expect(watchLink({ media })).toEqual({ to: '/watch/9', state: { media, upNext: [] } })
  })

  it('hands over the videos to play after it, in turn', () => {
    const media = mediaItem({ id: 9 })
    const upNext = [mediaItem({ id: 10 }), mediaItem({ id: 11 })]
    expect(watchLink({ media, upNext })).toEqual({ to: '/watch/9', state: { media, upNext } })
  })
})

describe('readWatchState', () => {
  it("reads what a link handed over for the video it plays, and nothing for another's", () => {
    const { state } = watchLink({ media: mediaItem({ id: 9 }), upNext: [mediaItem({ id: 10 })] })
    expect(readWatchState({ state, id: 9 })).toEqual(state)
    expect(readWatchState({ state, id: 10 })).toBeNull()
  })

  it('reads nothing from a direct visit, or state from before the queue', () => {
    expect(readWatchState({ state: null, id: 9 })).toBeNull()
    expect(readWatchState({ state: { media: mediaItem({ id: 9 }) }, id: 9 })).toBeNull()
  })
})

describe('cardLink', () => {
  it("opens a matched movie's page, naming the file when the movie was split onto several cards", () => {
    const item = itemSummary({ id: 4, type: 'movie' })
    expect(cardLink({ media: mediaItem({ id: 9, item }), pages: true })).toEqual({
      to: '/movies/4',
    })
    expect(
      cardLink({ media: mediaItem({ id: 9, item, variant: 'Final Cut' }), pages: true }),
    ).toEqual({ to: '/movies/4?file=9' })
  })

  it('plays a file straight away where the library has no pages', () => {
    const media = mediaItem({ id: 9, item: itemSummary({ id: 4, type: 'movie' }) })
    expect(cardLink({ media, pages: false })).toEqual(watchLink({ media }))
  })
})
