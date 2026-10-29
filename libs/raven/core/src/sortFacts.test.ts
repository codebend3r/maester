import type { MediaSort } from '@/contract'
import { describe, expect, it } from 'bun:test'
import { formatAirDate } from '@/itemFacts'
import { cardSortFact, showSortFact, sortFact } from '@/sortFacts'
import { itemSummary, mediaItem, showEntry } from '@/test/fixtures'

const NOW = new Date('2026-09-30T00:00:00.000Z')

describe('sortFact', () => {
  const media = mediaItem({
    size: 4_900_000_000,
    bitrate: 12_300_000,
    width: 3840,
    height: 2160,
    addedAt: '2026-09-27T00:00:00.000Z',
    changedAt: '2026-09-29T22:00:00.000Z',
  })
  const fact = (sort: MediaSort) => sortFact({ media, sort, now: NOW })

  it.each<[MediaSort, string]>([
    ['added', 'Added 3 days ago'],
    ['oldest', 'Added 3 days ago'],
    ['changed', 'Changed 2 hours ago'],
    ['largest', '4.9 GB'],
    ['smallest', '4.9 GB'],
    ['bitrate-high', '12.3 Mb/s'],
    ['bitrate-low', '12.3 Mb/s'],
    ['resolution-high', '4K'],
    ['resolution-low', '4K'],
  ])('says what %s sorts by', (sort, expected) => {
    expect(fact(sort)).toBe(expected)
  })

  it.each<MediaSort>(['year-new', 'year-old'])('says the day it came out for %s', (sort) => {
    const released = mediaItem({ item: itemSummary({ released: '2026-03-07' }) })
    expect(sortFact({ media: released, sort, now: NOW })).toBe(formatAirDate('2026-03-07'))
  })

  it('has nothing to say of a release day TMDB did not give', () => {
    const undated = mediaItem({ item: itemSummary({ released: null }) })
    expect(sortFact({ media: undated, sort: 'year-new', now: NOW })).toBeNull()
    expect(sortFact({ media: mediaItem({ item: null }), sort: 'year-new', now: NOW })).toBeNull()
  })

  it.each<MediaSort>(['title', 'rating-high', 'rating-low', 'random'])(
    'adds nothing for %s, which a card already shows or has no value',
    (sort) => {
      expect(fact(sort)).toBeNull()
    },
  )

  it('has nothing to say of a file not probed yet', () => {
    const unprobed = mediaItem({ bitrate: null, width: null, height: null })
    expect(sortFact({ media: unprobed, sort: 'bitrate-high', now: NOW })).toBeNull()
    expect(sortFact({ media: unprobed, sort: 'resolution-high', now: NOW })).toBeNull()
  })
})

describe('cardSortFact', () => {
  const released = mediaItem({
    size: 4_900_000_000,
    item: itemSummary({ released: '2026-03-07' }),
  })

  it('says the year for a release sort that gives the day, and for no other', () => {
    expect(cardSortFact({ media: released, sort: 'year-new' })).toEqual({
      sorted: formatAirDate('2026-03-07'),
      isYearSaid: true,
    })
    expect(cardSortFact({ media: released, sort: 'largest' })).toEqual({
      sorted: '4.9 GB',
      isYearSaid: false,
    })
  })

  it('leaves the year to the card when there is no order or no day', () => {
    expect(cardSortFact({ media: released, sort: undefined })).toEqual({
      sorted: null,
      isYearSaid: false,
    })
    const undated = mediaItem({ item: itemSummary({ released: null }) })
    expect(cardSortFact({ media: undated, sort: 'year-new' })).toEqual({
      sorted: null,
      isYearSaid: false,
    })
  })
})

describe('showSortFact', () => {
  it('says the day a show first aired for a sort by release', () => {
    const entry = showEntry({ show: itemSummary({ released: '2019-05-12' }) })
    expect(showSortFact({ entry, sort: 'year-new', now: NOW })).toBe(formatAirDate('2019-05-12'))
  })

  it('says when the newest episode came for a sort by when shows were added', () => {
    const entry = showEntry({ addedAt: '2026-08-30T00:00:00.000Z' })
    expect(showSortFact({ entry, sort: 'added', now: NOW })).toBe('Added last month')
    expect(showSortFact({ entry, sort: 'oldest', now: NOW })).toBe('Added last month')
    expect(showSortFact({ entry, sort: 'title', now: NOW })).toBeNull()
  })

  it("says its files' mean bitrate for a sort by bitrate, and nothing before one is probed", () => {
    const entry = showEntry({ bitrate: 8_400_000 })
    expect(showSortFact({ entry, sort: 'bitrate-high', now: NOW })).toBe('8.4 Mb/s')
    expect(showSortFact({ entry, sort: 'bitrate-low', now: NOW })).toBe('8.4 Mb/s')
    expect(
      showSortFact({ entry: showEntry({ bitrate: null }), sort: 'bitrate-high', now: NOW }),
    ).toBeNull()
  })
})
