import { describe, expect, it } from 'bun:test'

import { MUSIC_SORTS, MUSIC_SORT_LABELS } from '@raven/core'

import {
  COVER_SIZE_OPTIONS,
  HOME_RECENT_CHOICES,
  HOME_RECENT_TITLES,
  MUSIC_SORT_OPTIONS,
} from '@/choices'
import { HOME_COPY, LIBRARY_PAGE_COPY } from '@/copy/screens'
import { COVER_SIZES, RECENT_SORTS } from '@/prefs'

describe('HOME_RECENT_CHOICES', () => {
  it('offers the latest releases first, then the albums added last', () => {
    expect(HOME_RECENT_CHOICES).toEqual([
      { key: RECENT_SORTS.release, label: HOME_COPY.sorts.release },
      { key: RECENT_SORTS.added, label: HOME_COPY.sorts.added },
    ])
  })
})

describe('HOME_RECENT_TITLES', () => {
  it('names the section after the order it is in', () => {
    expect(HOME_RECENT_TITLES[RECENT_SORTS.added]).toBe(LIBRARY_PAGE_COPY.recent)
    expect(HOME_RECENT_TITLES[RECENT_SORTS.release]).toBe(HOME_COPY.latestReleases)
  })
})

describe('MUSIC_SORT_OPTIONS', () => {
  it("offers every one of raven's sorts, in raven's order and words", () => {
    expect(MUSIC_SORT_OPTIONS.map(({ value }) => value)).toEqual(Object.values(MUSIC_SORTS))
    expect(MUSIC_SORT_OPTIONS.every(({ value, label }) => label === MUSIC_SORT_LABELS[value])).toBe(
      true,
    )
  })
})

describe('COVER_SIZE_OPTIONS', () => {
  it('offers the five sizes smallest first, each in its word', () => {
    expect(COVER_SIZE_OPTIONS).toEqual([
      { value: COVER_SIZES.extraSmall, label: LIBRARY_PAGE_COPY.coverSizes.extraSmall },
      { value: COVER_SIZES.small, label: LIBRARY_PAGE_COPY.coverSizes.small },
      { value: COVER_SIZES.medium, label: LIBRARY_PAGE_COPY.coverSizes.medium },
      { value: COVER_SIZES.large, label: LIBRARY_PAGE_COPY.coverSizes.large },
      { value: COVER_SIZES.extraLarge, label: LIBRARY_PAGE_COPY.coverSizes.extraLarge },
    ])
  })
})
