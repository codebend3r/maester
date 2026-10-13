import { TIER_SETS } from '@raven/core'
import { describe, expect, it } from 'vitest'
import { pickByTiers, pickMatch } from '@/metadata/matcher'
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
  genreIds: [],
  originalLanguage: null,
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

describe('pickByTiers', () => {
  /** The 2021 live-action series, listed first as the more popular. */
  const liveAction = result({
    tmdbId: '90660',
    title: 'Cowboy Bebop',
    year: 2021,
    popularity: 80,
    genreIds: [10759, 18],
    originalLanguage: 'en',
    countries: ['US'],
  })
  const anime = result({
    tmdbId: '30991',
    title: 'Cowboy Bebop',
    year: 1998,
    popularity: 60,
    genreIds: [16, 10759],
    originalLanguage: 'ja',
    countries: ['JP'],
  })

  it('takes the more popular series in a TV library, and the anime in an Anime one', () => {
    const asked = { type: 'show', title: 'Cowboy Bebop', year: null } as const
    const results = [liveAction, anime]
    expect(pickByTiers({ ...asked, results, prefer: TIER_SETS.any })).toBe(liveAction)
    expect(pickByTiers({ ...asked, results, prefer: TIER_SETS.anime })).toBe(anime)
  })

  it('takes Avatar: The Last Airbender as the cartoon in an Anime library, through the animation tier', () => {
    const asked = { type: 'show', title: 'Avatar The Last Airbender', year: null } as const
    const netflix = result({
      tmdbId: '82452',
      title: 'Avatar: The Last Airbender',
      year: 2024,
      popularity: 200,
      genreIds: [10759, 18],
      originalLanguage: 'en',
      countries: ['US'],
    })
    const cartoon = result({
      tmdbId: '246',
      title: 'Avatar: The Last Airbender',
      year: 2005,
      popularity: 100,
      genreIds: [16, 10759],
      originalLanguage: 'en',
      countries: ['US'],
    })
    const results = [netflix, cartoon]
    expect(pickByTiers({ ...asked, results, prefer: TIER_SETS.any })).toBe(netflix)
    expect(pickByTiers({ ...asked, results, prefer: TIER_SETS.anime })).toBe(cartoon)
  })

  it('matches a Chinese donghua in an Anime library through the animation tier', () => {
    const donghua = result({
      tmdbId: '259140',
      title: 'TO BE HERO X',
      year: 2025,
      genreIds: [16, 10759],
      originalLanguage: 'zh',
      countries: ['CN'],
    })
    expect(
      pickByTiers({
        type: 'show',
        title: 'To Be Hero X',
        year: 2025,
        results: [donghua],
        prefer: TIER_SETS.anime,
      }),
    ).toBe(donghua)
  })

  it('never takes the lone result a filter leaves when its title is another', () => {
    const other = result({
      tmdbId: '1',
      title: 'Ninja Scroll: The Series',
      year: 2003,
      genreIds: [16],
      originalLanguage: 'ja',
      countries: ['JP'],
    })
    const liveDrama = result({ tmdbId: '2', title: 'Ninja Detective', year: 2003, genreIds: [18] })
    expect(
      pickByTiers({
        type: 'show',
        title: 'Ninja Scroll',
        year: 2003,
        results: [other, liveDrama],
        prefer: TIER_SETS.anime,
      }),
    ).toBeNull()
  })

  it('picks as pickMatch does in a library that prefers nothing, a lone result included', () => {
    const lone = result({ tmdbId: '7', title: 'Something Else', year: 1999 })
    const asked = { type: 'movie', title: 'The Matrix', year: 1999, results: [lone] } as const
    expect(pickByTiers({ ...asked, prefer: TIER_SETS.any })).toBe(pickMatch(asked))
    expect(pickByTiers({ ...asked, prefer: TIER_SETS.any })).toBe(lone)
    expect(pickByTiers({ ...asked, prefer: TIER_SETS.any, canTakeLoneResult: false })).toBeNull()
  })

  it('takes a lone live-action result in an Anime library through its last tier, as a Movies one would', () => {
    const lone = result({
      tmdbId: '8',
      title: 'Something Else',
      year: 1999,
      genreIds: [28],
      originalLanguage: 'en',
    })
    const asked = { type: 'movie', title: 'The Matrix', year: 1999, results: [lone] } as const
    expect(pickByTiers({ ...asked, prefer: TIER_SETS.anime })).toBe(pickMatch(asked))
    expect(pickByTiers({ ...asked, prefer: TIER_SETS.anime })).toBe(lone)
  })
})
