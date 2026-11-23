import { describe, expect, it } from 'bun:test'

import { librariesSummaryOf, libraryLineOf } from '@/queries/libraryList'
import { FILMS, SERIES } from '@/test/homeServer'

const LOCKED_SERIES = { ...SERIES, settings: { ...SERIES.settings, locked: true } }

describe('locked libraries in the lists', () => {
  it("says a library card's type and counts, a locked one marked locked", () => {
    expect([FILMS, LOCKED_SERIES].map(libraryLineOf)).toEqual([
      'Movies · 2 videos',
      'TV shows · Locked · 2 videos',
    ])
  })

  it('counts what has not been matched yet', () => {
    expect(libraryLineOf({ ...FILMS, itemCount: 1204, unmatchedCount: 3 })).toBe(
      'Movies · 1,204 videos · 3 not matched',
    )
  })

  it('sums the libraries and their videos for the page', () => {
    expect(librariesSummaryOf([FILMS, LOCKED_SERIES])).toBe('2 libraries · 4 videos')
  })
})
