import { describe, expect, it } from 'bun:test'
import { episodeBackPath, itemPath, watchLink } from '@/lib/itemLinks'
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
  it('hands the video over in router state', () => {
    const media = mediaItem({ id: 9 })
    expect(watchLink(media)).toEqual({ to: '/watch/9', state: { media } })
  })
})
