import { describe, expect, it } from 'bun:test'
import { ITEM_TYPES } from '@/contract/items'
import { uniqueUpcomingTitles } from '@/contract/upcoming'

describe('uniqueUpcomingTitles', () => {
  it('keeps each movie or show once, where it first comes', () => {
    const movie = { type: ITEM_TYPES.movie, tmdbId: '1', at: 'first' }
    const show = { type: ITEM_TYPES.show, tmdbId: '1', at: 'second' }
    expect(
      uniqueUpcomingTitles([movie, show, { type: ITEM_TYPES.movie, tmdbId: '1', at: 'third' }]),
    ).toEqual([movie, show])
  })
})
