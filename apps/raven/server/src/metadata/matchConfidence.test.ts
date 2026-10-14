import { type CandidateTier, TIER_SETS } from '@raven/core'
import { describe, expect, it } from 'vitest'
import { type EpisodeNumbers, type OnDisk, scoreCandidates } from '@/metadata/matchConfidence'
import type { MatchFacts, SearchResult } from '@/metadata/tmdbClient'

const result = (
  fields: Pick<SearchResult, 'tmdbId' | 'title'> & Partial<SearchResult>,
): SearchResult => ({
  originalTitle: null,
  year: null,
  overview: null,
  poster: null,
  popularity: null,
  countries: [],
  genreIds: [],
  originalLanguage: null,
  ...fields,
})

const show = (fields: Partial<Extract<MatchFacts, { type: 'show' }>>): MatchFacts => ({
  type: 'show',
  aliases: [],
  seasons: [],
  episodeCount: null,
  ...fields,
})

const movie = (fields: Partial<Extract<MatchFacts, { type: 'movie' }>>): MatchFacts => ({
  type: 'movie',
  aliases: [],
  runtime: null,
  ...fields,
})

const episodes = (season: number, ...numbers: number[]): EpisodeNumbers[] =>
  numbers.map((episode) => ({ season, episodes: [episode], absolute: null, year: null }))

const ANY = TIER_SETS.any[0]

const score = ({
  title,
  year = null,
  country = null,
  results,
  tier = ANY,
  onDisk = null,
  facts = new Map(),
}: {
  title: string
  year?: number | null
  country?: string | null
  results: SearchResult[]
  tier?: CandidateTier
  onDisk?: OnDisk | null
  facts?: Map<string, MatchFacts>
}): number[] => scoreCandidates({ title, year, country, results, tier, onDisk, facts })

describe('scoreCandidates', () => {
  it('scores an exact title with nothing else to go on 100', () => {
    expect(
      score({ title: 'Severance', results: [result({ tmdbId: '1', title: 'Severance' })] }),
    ).toEqual([100])
  })

  it('counts the original title and an alias as the title', () => {
    const results = [
      result({
        tmdbId: '1',
        title: 'Spirited Away',
        originalTitle: 'Sen to Chihiro no Kamikakushi',
      }),
      result({ tmdbId: '2', title: 'Loveland' }),
    ]
    expect(
      score({
        title: 'Sen to Chihiro no Kamikakushi',
        results: results.slice(0, 1),
      }),
    ).toEqual([100])
    expect(
      score({
        title: 'Expired',
        results: results.slice(1),
        facts: new Map([['2', movie({ aliases: ['Expired'] })]]),
      }),
    ).toEqual([100])
  })

  it('scores a typo Possible and extra words Weak, by edit distance', () => {
    expect(
      score({ title: 'Wild Arctik', results: [result({ tmdbId: '1', title: 'Wild Arctic' })] }),
    ).toEqual([73])
    expect(
      score({
        title: 'Monster',
        results: [
          result({ tmdbId: '1', title: 'Monster High' }),
          result({ tmdbId: '2', title: 'Monster: The Lizzie Borden Story' }),
        ],
      }),
    ).toEqual([47, 18])
  })

  it('compares a title with no Latin letters as it is written', () => {
    expect(
      score({
        title: '몬스터',
        results: [result({ tmdbId: '1', title: '몬스터' }), result({ tmdbId: '2', title: '괴물' })],
      }),
    ).toEqual([100, 0])
  })

  it('compares a title with a letter outside the Latin script as it is written, digits and all', () => {
    // Folded, each would be "1988", and so the other's exact title.
    expect(
      score({
        title: '응답하라 1988',
        results: [
          result({ tmdbId: '1', title: '응답하라 1988' }),
          result({ tmdbId: '2', title: '괴물 1988' }),
        ],
      }),
    ).toEqual([100, 44])
  })

  it('steps the year down one, three and more years off, and marks a result with no year down', () => {
    const results = [2020, 2021, 2023, 2026].map((year, index) =>
      result({ tmdbId: String(index), title: `Heat ${index}`, year }),
    )
    // Each title is 'heat n' against 'heat n': exact, so only the year moves the score.
    const scored = results.map(
      (each, index) => score({ title: `Heat ${index}`, year: 2020, results: [each] })[0],
    )
    expect(scored).toEqual([100, 92, 76, 60])
    expect(
      score({ title: 'Heat', year: 2020, results: [result({ tmdbId: '9', title: 'Heat' })] }),
    ).toEqual([60])
  })

  it('averages the support over only what it can measure', () => {
    // Year 2021 (0.8 of 30) with a fit (1 of 20): (24 + 20) / 50 = 0.88.
    expect(
      score({
        title: 'Short Film',
        year: 2020,
        results: [result({ tmdbId: '1', title: 'Short Film', year: 2021 })],
        onDisk: { type: 'movie', duration: 95 * 60 },
        facts: new Map([['1', movie({ runtime: 100 })]]),
      }),
    ).toEqual([95])
  })

  it('weighs popularity only between results that share the title', () => {
    // A more popular show by another name never marks the lone exact title down.
    expect(
      score({
        title: 'Patriot',
        results: [
          result({ tmdbId: '1', title: 'Patriot Games', popularity: 90 }),
          result({ tmdbId: '2', title: 'Patriot', popularity: 10 }),
        ],
      }),
    ).toEqual([43, 100])
    // Two exact titles: the less popular one is marked down by how much less.
    expect(
      score({
        title: 'Patriot',
        results: [
          result({ tmdbId: '1', title: 'The Patriot', popularity: 90 }),
          result({ tmdbId: '2', title: 'Patriot', popularity: 10 }),
        ],
      }),
    ).toEqual([100, 64])
  })

  it("prefers the library type's first tier", () => {
    const results = [
      result({
        tmdbId: '90660',
        title: 'Cowboy Bebop',
        genreIds: [10759, 18],
        originalLanguage: 'en',
      }),
      result({
        tmdbId: '30991',
        title: 'Cowboy Bebop',
        genreIds: [16],
        originalLanguage: 'ja',
        countries: ['JP'],
      }),
    ]
    expect(score({ title: 'Cowboy Bebop', results, tier: TIER_SETS.anime[0] })).toEqual([60, 100])
  })

  describe('a show folder', () => {
    const monster = [
      result({ tmdbId: '30981', title: 'Monster', year: 2004, popularity: 50 }),
      result({ tmdbId: '65806', title: 'Monster', year: 2016, popularity: 10 }),
      result({ tmdbId: '131532', title: 'Monster High', year: 2022, popularity: 80 }),
      result({ tmdbId: '299939', title: 'Monster: The Lizzie Borden Story', year: 2026 }),
    ]
    const facts = new Map<string, MatchFacts>([
      ['30981', show({ seasons: [{ number: 1, episodeCount: 74 }], episodeCount: 74 })],
      ['65806', show({ seasons: [{ number: 1, episodeCount: 50 }], episodeCount: 50 })],
      ['131532', show({ seasons: [{ number: 1, episodeCount: 13 }], episodeCount: 13 })],
    ])
    const onDisk: OnDisk = { type: 'show', files: episodes(1, 1, 2, 35) }

    it('makes the spec example a close call, both Possible, and the rest Weak', () => {
      expect(score({ title: 'Monster', results: monster, onDisk, facts })).toEqual([79, 79, 28, 18])
    })

    it('names the more popular the winner when nothing is on disk', () => {
      expect(score({ title: 'Monster', results: monster })).toEqual([100, 68, 47, 18])
    })

    it('caps a show without an episode on disk at 40', () => {
      const wrong = new Map<string, MatchFacts>([
        ['30981', show({ seasons: [{ number: 1, episodeCount: 20 }], episodeCount: 20 })],
      ])
      expect(
        score({ title: 'Monster', results: monster.slice(0, 1), onDisk, facts: wrong }),
      ).toEqual([40])
    })

    it('fits a season numbered straight through, and absolute numbers, within the total', () => {
      const split = new Map<string, MatchFacts>([
        [
          '30981',
          show({
            seasons: [
              { number: 1, episodeCount: 25 },
              { number: 2, episodeCount: 49 },
            ],
            episodeCount: 74,
          }),
        ],
      ])
      const straight: OnDisk = { type: 'show', files: episodes(1, 60) }
      const absolute: OnDisk = {
        type: 'show',
        files: [{ season: null, episodes: [], absolute: 70, year: null }],
      }
      const later: OnDisk = { type: 'show', files: episodes(2, 60) }
      const run = (disk: OnDisk) =>
        score({ title: 'Monster', results: monster.slice(0, 1), onDisk: disk, facts: split })
      expect(run(straight)).toEqual([100])
      expect(run(absolute)).toEqual([100])
      expect(run(later)).toEqual([40])
    })

    it('leaves season 0 and unnumbered files out, and measures no fit when none is left', () => {
      const specials: OnDisk = {
        type: 'show',
        files: [...episodes(0, 99), { season: 1, episodes: [], absolute: null, year: null }],
      }
      expect(
        score({ title: 'Monster', results: monster.slice(0, 1), onDisk: specials, facts }),
      ).toEqual([100])
    })

    describe('beside 74 episodes that fit', () => {
      const fitting = episodes(1, ...Array.from({ length: 74 }, (_, index) => index + 1))
      const run = (stray: EpisodeNumbers) =>
        score({
          title: 'Monster',
          results: monster.slice(0, 1),
          onDisk: { type: 'show', files: [...fitting, stray] },
          facts,
        })

      it("reads an absolute number that is the name's year as no number", () => {
        // `Monster (2004) - Making Of.mkv` in `Monster (2004)/`.
        expect(run({ season: null, episodes: [], absolute: 2004, year: 2004 })).toEqual([100])
        expect(run({ season: null, episodes: [], absolute: 2004, year: null })).toEqual([40])
      })

      it('reads episode 0, a pilot, as no number', () => {
        expect(run({ season: 1, episodes: [0], absolute: null, year: null })).toEqual([100])
        expect(run({ season: 1, episodes: [0, 75], absolute: null, year: null })).toEqual([40])
      })
    })

    it('measures no fit for a result whose details were not read', () => {
      expect(score({ title: 'Monster', results: monster.slice(0, 1), onDisk })).toEqual([100])
    })
  })

  describe('a movie file', () => {
    const film = [result({ tmdbId: '1', title: 'Heat', year: 1995 })]
    const run = ({ minutes, runtime }: { minutes: number | null; runtime: number | null }) =>
      score({
        title: 'Heat',
        year: 1995,
        results: film,
        onDisk: { type: 'movie', duration: minutes == null ? null : minutes * 60 },
        facts: new Map([['1', movie({ runtime })]]),
      })

    it('fits within 10 minutes, half within 25, and caps it further off at 40', () => {
      expect(run({ minutes: 170, runtime: 170 })).toEqual([100])
      expect(run({ minutes: 150, runtime: 170 })).toEqual([92])
      expect(run({ minutes: 22, runtime: 170 })).toEqual([40])
    })

    it('measures no fit for an unprobed file or no runtime', () => {
      expect(run({ minutes: null, runtime: 170 })).toEqual([100])
      expect(run({ minutes: 22, runtime: null })).toEqual([100])
    })
  })

  it("caps a show from another country than the name's at 40", () => {
    const results = [
      result({ tmdbId: '2316', title: 'The Office', countries: ['US'], popularity: 90 }),
      result({ tmdbId: '2996', title: 'The Office', countries: ['GB'], popularity: 30 }),
    ]
    // The US one is held at 40, and, ruled out, is not the popularity the UK one is measured by.
    expect(score({ title: 'The Office', country: 'GB', results })).toEqual([40, 100])
  })

  it('makes no close call below 80, or when the runner-up is more than 10 behind', () => {
    const results = [
      result({ tmdbId: '1', title: 'Unknown Thing One' }),
      result({ tmdbId: '2', title: 'Unknown Thing Two' }),
    ]
    expect(score({ title: 'Unknown Thing', results })).toEqual([69, 69])
    expect(
      score({
        title: 'Heat',
        year: 1995,
        results: [
          result({ tmdbId: '1', title: 'Heat', year: 1995 }),
          result({ tmdbId: '2', title: 'Heat', year: 1986 }),
        ],
      }),
    ).toEqual([100, 60])
  })

  it('makes a close call of a runner-up exactly 10 behind a Strong top, and not of one 11 behind', () => {
    // Popularity alone is the support: 0.75 of the top's is 90, and 0.725 is 89.
    const heat = (popularity: number) => [
      result({ tmdbId: '1', title: 'Heat', popularity: 100 }),
      result({ tmdbId: '2', title: 'Heat', popularity }),
    ]
    expect(score({ title: 'Heat', results: heat(75) })).toEqual([79, 79])
    expect(score({ title: 'Heat', results: heat(72.5) })).toEqual([100, 89])
  })
})
