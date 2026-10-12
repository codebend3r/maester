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
  countries: [],
  ...overrides,
})

describe('pickMatch', () => {
  it('accepts the same title in the same year', () => {
    const matrix = result({ tmdbId: '603' })
    expect(
      pickMatch({
        type: 'movie',
        title: 'Matrix',
        year: 1999,
        results: [result({ tmdbId: '2', title: 'The Matrix Reloaded', year: 2003 }), matrix],
      }),
    ).toBe(matrix)
  })

  it('accepts a year either side, preferring the exact one', () => {
    const near = result({ tmdbId: 'near', year: 2000 })
    expect(pickMatch({ type: 'movie', title: 'The Matrix', year: 1999, results: [near] })).toBe(
      near,
    )
    const exact = result({ tmdbId: 'exact', year: 1999 })
    expect(
      pickMatch({ type: 'movie', title: 'The Matrix', year: 1999, results: [near, exact] }),
    ).toBe(exact)
  })

  it('accepts the nearest year within three, as a festival and a release can differ', () => {
    const release = result({ tmdbId: 'release', title: 'The Evil Dead', year: 1983 })
    expect(
      pickMatch({ type: 'movie', title: 'The Evil Dead', year: 1981, results: [release] }),
    ).toBe(release)
    const remake = result({ tmdbId: 'remake', title: 'Evil Dead', year: 2013 })
    expect(
      pickMatch({ type: 'movie', title: 'The Evil Dead', year: 1981, results: [remake, release] }),
    ).toBe(release)
    expect(
      pickMatch({
        type: 'movie',
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
      pickMatch({
        type: 'movie',
        title: "Le Fabuleux Destin d'Amelie Poulain",
        year: 2001,
        results: [amelie],
      }),
    ).toBe(amelie)
  })

  it('accepts a lone result in the right year whatever its title', () => {
    const only = result({ title: 'Se7en', year: 1995 })
    expect(pickMatch({ type: 'movie', title: 'Seven', year: 1995, results: [only] })).toBe(only)
  })

  it('accepts a title TMDB knows a result by, as with a film released abroad under another name', () => {
    const loveland = result({ tmdbId: '659924', title: 'Loveland', year: 2022 })
    const jam = result({ tmdbId: '1109028', title: 'Maria Elena e o Pote de Geleia', year: 2023 })
    const results = [loveland, jam]
    expect(pickMatch({ type: 'movie', title: 'Expired', year: 2022, results })).toBeNull()
    expect(
      pickMatch({
        type: 'movie',
        title: 'Expired',
        year: 2022,
        results,
        aliases: new Map([['659924', ['Expired', 'Просроченный']]]),
      }),
    ).toBe(loveland)
    const vidaLoca = result({ tmdbId: '32325', title: 'Mi Vida Loca', year: 1994 })
    expect(
      pickMatch({
        type: 'movie',
        title: 'My Crazy Life',
        year: 1993,
        results: [vidaLoca],
        aliases: new Map([['32325', ['My Crazy Life']]]),
      }),
    ).toBe(vidaLoca)
  })

  it('takes a lone result of another title only when told it can', () => {
    const only = result({ title: 'Se7en', year: 1995 })
    expect(
      pickMatch({
        type: 'movie',
        title: 'Seven',
        year: 1995,
        results: [only],
        canTakeLoneResult: false,
      }),
    ).toBeNull()
    expect(
      pickMatch({
        type: 'movie',
        title: 'Se7en',
        year: 1995,
        results: [only],
        canTakeLoneResult: false,
      }),
    ).toBe(only)
  })

  it('refuses anything unsure', () => {
    expect(
      pickMatch({
        type: 'movie',
        title: 'Seven',
        year: 1995,
        results: [result({ title: 'Se7en', year: 1996 })],
      }),
    ).toBeNull()
    expect(
      pickMatch({
        type: 'movie',
        title: 'Seven',
        year: 1995,
        results: [
          result({ title: 'Se7en', year: 1995 }),
          result({ title: 'Seven Years', year: 1995 }),
        ],
      }),
    ).toBeNull()
    expect(pickMatch({ type: 'movie', title: 'The Matrix', year: 1999, results: [] })).toBeNull()
    expect(
      pickMatch({ type: 'movie', title: 'The Matrix', year: 1990, results: [result({})] }),
    ).toBeNull()
  })

  it('takes a name without a year to the result with its title', () => {
    expect(
      pickMatch({ type: 'movie', title: 'The Matrix', year: null, results: [result({})] }),
    ).not.toBeNull()
    expect(
      pickMatch({
        type: 'movie',
        title: 'The Matrix',
        year: null,
        results: [result({ title: 'Matrix Reloaded' })],
      }),
    ).toBeNull()
  })

  it('settles two results with the same title by popularity, in or out of a year', () => {
    const popular = result({ tmdbId: 'popular', title: 'Snowfall', year: 2017, popularity: 80 })
    const obscure = result({ tmdbId: 'obscure', title: 'Snowfall', year: 2016, popularity: 2 })
    expect(
      pickMatch({ type: 'show', title: 'Snowfall', year: null, results: [obscure, popular] }),
    ).toBe(popular)
    expect(
      pickMatch({ type: 'show', title: 'Snowfall', year: 2017, results: [obscure, popular] }),
    ).toBe(popular)
    const remake = result({ tmdbId: 'remake', title: 'Snowfall', year: 2017, popularity: 1 })
    expect(
      pickMatch({ type: 'movie', title: 'Snowfall', year: 2017, results: [remake, popular] }),
    ).toBe(popular)
    // Without scores, TMDB's own order (most popular first) decides.
    const first = result({ tmdbId: 'first', title: 'Silo' })
    expect(
      pickMatch({
        type: 'show',
        title: 'Silo',
        year: null,
        results: [first, result({ tmdbId: 'second', title: 'Silo' })],
      }),
    ).toBe(first)
  })

  it('leaves a movie without a year unmatched when an original and its remake share the title', () => {
    const original = result({ tmdbId: 'original', title: 'The Thing', year: 1982, popularity: 30 })
    const remake = result({ tmdbId: 'remake', title: 'The Thing', year: 2011, popularity: 40 })
    expect(
      pickMatch({ type: 'movie', title: 'The Thing', year: null, results: [original, remake] }),
    ).toBeNull()
    expect(
      pickMatch({
        type: 'movie',
        title: 'The Thing',
        year: null,
        results: [original, result({ tmdbId: '2', title: 'The Thing Below', year: 2021 })],
      }),
    ).toBe(original)
  })

  it('takes a show named with a country only from there', () => {
    const us = result({
      tmdbId: 'us',
      title: 'The Office',
      year: 2005,
      popularity: 90,
      countries: ['US'],
    })
    const uk = result({
      tmdbId: 'uk',
      title: 'The Office',
      year: 2001,
      popularity: 20,
      countries: ['GB'],
    })
    const results = [us, uk]
    expect(pickMatch({ type: 'show', title: 'The Office', year: null, results })).toBe(us)
    expect(
      pickMatch({ type: 'show', title: 'The Office', year: null, country: 'GB', results }),
    ).toBe(uk)
    expect(
      pickMatch({ type: 'show', title: 'The Office', year: null, country: 'AU', results }),
    ).toBeNull()
    expect(
      pickMatch({ type: 'show', title: 'The Office', year: 2001, country: 'US', results: [uk] }),
    ).toBeNull()
  })

  it('takes the one result with the title among others without it, as show folders rarely carry a year', () => {
    const andor = result({ tmdbId: '83867', title: 'Andor', year: 2022 })
    expect(
      pickMatch({
        type: 'show',
        title: 'Andor',
        year: null,
        results: [andor, result({ tmdbId: '2', title: 'Andorra Between Two Evils', year: 2000 })],
      }),
    ).toBe(andor)
    expect(
      pickMatch({
        type: 'show',
        title: 'Andor',
        year: null,
        results: [result({ tmdbId: '2', title: 'Andorra Between Two Evils', year: 2000 })],
      }),
    ).toBeNull()
  })
})
