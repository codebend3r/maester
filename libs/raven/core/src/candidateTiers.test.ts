import { describe, expect, it } from 'bun:test'
import {
  type CandidateTier,
  type TierFacts,
  TIER_SETS,
  TMDB_GENRES,
  fitsTier,
  isUnfiltered,
} from '@/candidateTiers'

const facts = (overrides: Partial<TierFacts>): TierFacts => ({
  genreIds: [],
  originalLanguage: null,
  countries: [],
  ...overrides,
})

const [japanese, animated, anything] = TIER_SETS.anime

type FitsProps = { set: readonly CandidateTier[]; result: TierFacts }

/** Which of a set's tiers a result fits, by index. */
const fits = ({ set, result }: FitsProps): number[] =>
  set.flatMap((tier, index) => (fitsTier({ tier, result }) ? [index] : []))

describe('fitsTier', () => {
  it('fits a Japanese anime series to every anime tier', () => {
    const bebop = facts({ genreIds: [16, 10759], originalLanguage: 'ja', countries: ['JP'] })
    expect(fits({ set: TIER_SETS.anime, result: bebop })).toEqual([0, 1, 2])
  })

  it('fits an anime film by its language alone, as a movie search gives no countries', () => {
    const paprika = facts({ genreIds: [16, 878], originalLanguage: 'ja' })
    expect(fitsTier({ tier: japanese, result: paprika })).toBe(true)
  })

  it('fits a show made in Japan in English by its country', () => {
    const show = facts({ genreIds: [16], originalLanguage: 'en', countries: ['JP'] })
    expect(fitsTier({ tier: japanese, result: show })).toBe(true)
  })

  it('fits animation from elsewhere to the animation tier, not the Japanese one', () => {
    const donghua = facts({ genreIds: [16], originalLanguage: 'zh', countries: ['CN'] })
    const castlevania = facts({ genreIds: [16, 10759], originalLanguage: 'en', countries: ['US'] })
    expect(fits({ set: TIER_SETS.anime, result: donghua })).toEqual([1, 2])
    expect(fits({ set: TIER_SETS.anime, result: castlevania })).toEqual([1, 2])
  })

  it('fits Japanese live action only to the last anime tier', () => {
    const drama = facts({ genreIds: [18], originalLanguage: 'ja', countries: ['JP'] })
    expect(fits({ set: TIER_SETS.anime, result: drama })).toEqual([2])
  })

  it('fits a result TMDB lists no genres for only where nothing is filtered', () => {
    expect(fitsTier({ tier: animated, result: facts({ originalLanguage: 'ja' }) })).toBe(false)
    expect(fitsTier({ tier: anything, result: facts({}) })).toBe(true)
  })

  it('fits family films and animation first in a family library', () => {
    expect(fits({ set: TIER_SETS.family, result: facts({ genreIds: [10751, 35] }) })).toEqual([
      0, 1,
    ])
    expect(fits({ set: TIER_SETS.family, result: facts({ genreIds: [16] }) })).toEqual([0, 1])
    expect(fits({ set: TIER_SETS.family, result: facts({ genreIds: [27] }) })).toEqual([1])
  })

  it('fits documentaries first in a documentaries library', () => {
    const doc = facts({ genreIds: [TMDB_GENRES.documentary] })
    expect(fits({ set: TIER_SETS.documentary, result: doc })).toEqual([0, 1])
    expect(fits({ set: TIER_SETS.documentary, result: facts({ genreIds: [18] }) })).toEqual([1])
  })
})

describe('the tier sets', () => {
  it('end every set with a tier that is every result, so no type matches less than Movies', () => {
    expect(Object.values(TIER_SETS).map((set) => isUnfiltered(set.at(-1)!))).toEqual([
      true,
      true,
      true,
      true,
    ])
  })

  it('filter every tier but the last', () => {
    expect(
      Object.values(TIER_SETS).flatMap((set) => set.slice(0, -1).filter(isUnfiltered)),
    ).toEqual([])
  })
})
