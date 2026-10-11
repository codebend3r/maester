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

  it('takes a name without a year only when one result has its title', () => {
    expect(pickMatch({ title: 'The Matrix', year: null, results: [result({})] })).not.toBeNull()
    expect(
      pickMatch({ title: 'The Matrix', year: null, results: [result({}), result({ year: 2021 })] }),
    ).toBeNull()
  })
})
