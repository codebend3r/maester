import { ITEM_TYPES, UPCOMING_KINDS } from '@raven/core'
import { describe, expect, it } from 'vitest'
import { upcomingKindOf } from '@/upcoming/upcomingKind'

describe('upcomingKindOf', () => {
  it('names animation made in Japanese anime, by its type', () => {
    const anime = { genreIds: [16, 10759], originalLanguage: 'ja' }
    expect(upcomingKindOf({ ...anime, type: ITEM_TYPES.movie })).toBe(UPCOMING_KINDS.animeMovie)
    expect(upcomingKindOf({ ...anime, type: ITEM_TYPES.show })).toBe(UPCOMING_KINDS.animeShow)
  })

  it('names animation from anywhere else, and anything Japanese that is not animated, by its type alone', () => {
    expect(upcomingKindOf({ type: ITEM_TYPES.movie, genreIds: [16], originalLanguage: 'en' })).toBe(
      UPCOMING_KINDS.movie,
    )
    expect(upcomingKindOf({ type: ITEM_TYPES.show, genreIds: [18], originalLanguage: 'ja' })).toBe(
      UPCOMING_KINDS.show,
    )
  })

  it('names a documentary one whatever its type, as its shelf holds both', () => {
    expect(
      upcomingKindOf({ type: ITEM_TYPES.show, genreIds: [99, 16], originalLanguage: 'ja' }),
    ).toBe(UPCOMING_KINDS.documentary)
  })
})
