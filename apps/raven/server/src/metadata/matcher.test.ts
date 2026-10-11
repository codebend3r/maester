import { describe, expect, it } from 'vitest'
import { pickMatch } from '@/metadata/matcher'
import type { SearchResult } from '@/metadata/tmdbClient'

const result = (overrides: Partial<SearchResult>): SearchResult => ({
  tmdbId: '1',
  title: 'The Matrix',
  originalTitle: null,
  year: 1999,
  overview: null,
  poster: null,
  popularity: null,
  ...overrides,
})

describe('pickMatch', () => {
  it('accepts the same title in the same year', () => {
    const matrix = result({ tmdbId: '603' })
    expect(
      pickMatch({
        title: 'Matrix',
        year: 1999,
        results: [result({ tmdbId: '2', title: 'The Matrix Reloaded', year: 2003 }), matrix],
      }),
    ).toBe(matrix)
  })

  it('accepts a year either side, preferring the exact one', () => {
    const near = result({ tmdbId: 'near', year: 2000 })
    expect(pickMatch({ title: 'The Matrix', year: 1999, results: [near] })).toBe(near)
    const exact = result({ tmdbId: 'exact', year: 1999 })
    expect(pickMatch({ title: 'The Matrix', year: 1999, results: [near, exact] })).toBe(exact)
  })

  it('accepts the nearest year within three, as a festival and a release can differ', () => {
    const release = result({ tmdbId: 'release', title: 'The Evil Dead', year: 1983 })
    expect(pickMatch({ title: 'The Evil Dead', year: 1981, results: [release] })).toBe(release)
    const remake = result({ tmdbId: 'remake', title: 'Evil Dead', year: 2013 })
    expect(pickMatch({ title: 'The Evil Dead', year: 1981, results: [remake, release] })).toBe(
      release,
    )
    expect(
      pickMatch({
        title: 'The Evil Dead',
        year: 1981,
        results: [result({ title: 'The Evil Dead', year: 1985 })],
      }),
    ).toBeNull()
  })

  it('accepts an original title', () => {
    const amelie = result({
      title: 'Amélie',
      originalTitle: "Le Fabuleux Destin d'Amélie Poulain",
      year: 2001,
    })
    expect(
      pickMatch({ title: "Le Fabuleux Destin d'Amelie Poulain", year: 2001, results: [amelie] }),
    ).toBe(amelie)
  })

  it('accepts a lone result in the right year whatever its title', () => {
    const only = result({ title: 'Se7en', year: 1995 })
    expect(pickMatch({ title: 'Seven', year: 1995, results: [only] })).toBe(only)
  })

  it('refuses anything unsure', () => {
    expect(
      pickMatch({ title: 'Seven', year: 1995, results: [result({ title: 'Se7en', year: 1996 })] }),
    ).toBeNull()
    expect(
      pickMatch({
        title: 'Seven',
        year: 1995,
        results: [
          result({ title: 'Se7en', year: 1995 }),
          result({ title: 'Seven Years', year: 1995 }),
        ],
      }),
    ).toBeNull()
    expect(pickMatch({ title: 'The Matrix', year: 1999, results: [] })).toBeNull()
    expect(pickMatch({ title: 'The Matrix', year: 1990, results: [result({})] })).toBeNull()
  })

  it('takes a name without a year to the result with its title', () => {
    expect(pickMatch({ title: 'The Matrix', year: null, results: [result({})] })).not.toBeNull()
    expect(
      pickMatch({
        title: 'The Matrix',
        year: null,
        results: [result({ title: 'Matrix Reloaded' })],
      }),
    ).toBeNull()
  })

  it('settles two results with the same title by popularity, in or out of a year', () => {
    const popular = result({ tmdbId: 'popular', title: 'Snowfall', year: 2017, popularity: 80 })
    const obscure = result({ tmdbId: 'obscure', title: 'Snowfall', year: 2016, popularity: 2 })
    expect(pickMatch({ title: 'Snowfall', year: null, results: [obscure, popular] })).toBe(popular)
    expect(pickMatch({ title: 'Snowfall', year: 2017, results: [obscure, popular] })).toBe(popular)
    const remake = result({ tmdbId: 'remake', title: 'Snowfall', year: 2017, popularity: 1 })
    expect(pickMatch({ title: 'Snowfall', year: 2017, results: [remake, popular] })).toBe(popular)
    // Without scores, TMDB's own order (most popular first) decides.
    const first = result({ tmdbId: 'first', title: 'Silo' })
    expect(
      pickMatch({
        title: 'Silo',
        year: null,
        results: [first, result({ tmdbId: 'second', title: 'Silo' })],
      }),
    ).toBe(first)
  })

  it('takes the one result with the title among others without it, as show folders rarely carry a year', () => {
    const andor = result({ tmdbId: '83867', title: 'Andor', year: 2022 })
    expect(
      pickMatch({
        title: 'Andor',
        year: null,
        results: [andor, result({ tmdbId: '2', title: 'Andorra Between Two Evils', year: 2000 })],
      }),
    ).toBe(andor)
    expect(
      pickMatch({
        title: 'Andor',
        year: null,
        results: [result({ tmdbId: '2', title: 'Andorra Between Two Evils', year: 2000 })],
      }),
    ).toBeNull()
  })
})
