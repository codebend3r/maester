import type { MediaSort } from '@/contract'
import { describe, expect, it } from 'vitest'
import { showSortFact, sortFact } from '@/sortFacts'
import { mediaItem, showEntry } from '@/test/fixtures'

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

  it.each<MediaSort>(['title', 'year-new', 'year-old', 'rating-high', 'rating-low', 'random'])(
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

describe('showSortFact', () => {
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
