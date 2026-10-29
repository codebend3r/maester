import { describe, expect, it } from 'bun:test'
import {
  cardTitle,
  episodeCode,
  episodePlace,
  formatScore,
  itemLabel,
  mediaLabel,
  pickScore,
  primaryVersion,
  tileWords,
} from '@/items'
import { ITEM_TYPES } from '@/contract'
import { itemSummary, mediaItem } from '@/test/fixtures'

describe('episodeCode', () => {
  it('pads seasons and episodes to two digits, and keeps three', () => {
    expect(episodeCode({ season: 1, episode: 2 })).toBe('S01E02')
    expect(episodeCode({ season: 1, episode: 123 })).toBe('S01E123')
    expect(episodeCode({ season: 0, episode: null })).toBe('S00')
    expect(episodeCode({ season: null, episode: 3 })).toBeNull()
  })
})

describe('itemLabel', () => {
  it('gives a movie its year', () => {
    expect(itemLabel(itemSummary())).toBe('The Matrix (1999)')
    expect(itemLabel(itemSummary({ year: null }))).toBe('The Matrix')
  })

  it('gives an episode its show and code', () => {
    expect(
      itemLabel(
        itemSummary({
          type: ITEM_TYPES.episode,
          title: 'Half Loop',
          show: { id: 3, title: 'Severance' },
          season: 1,
          episode: 2,
        }),
      ),
    ).toBe('Severance · S01E02 · Half Loop')
  })
})

describe('pickScore and formatScore', () => {
  const ratings = [
    { source: 'tmdb' as const, kind: 'audience' as const, value: 8.2, votes: 10 },
    { source: 'rottenTomatoes' as const, kind: 'critic' as const, value: 4.1, votes: null },
    { source: 'metacritic' as const, kind: 'critic' as const, value: 7.4, votes: null },
  ]

  it("picks the library's source, and falls back to TMDB's", () => {
    expect(pickScore({ ratings, source: 'rottenTomatoes' })?.value).toBe(4.1)
    expect(pickScore({ ratings, source: 'imdb' })?.source).toBe('tmdb')
    expect(pickScore({ ratings: [], source: 'tmdb' })).toBeNull()
  })

  it('reads each source its own way', () => {
    expect(
      formatScore(ratings[0] ?? { source: 'tmdb', kind: 'audience', value: 0, votes: 0 }),
    ).toBe('82%')
    expect(formatScore({ source: 'imdb', kind: 'audience', value: 7.5, votes: null })).toBe('7.5')
    expect(formatScore({ source: 'metacritic', kind: 'critic', value: 7.4, votes: null })).toBe(
      '74',
    )
  })
})

describe('mediaLabel and cardTitle', () => {
  it('prefer the matched item', () => {
    const matched = mediaItem({ title: 'Matrix', year: 1998, item: itemSummary() })
    expect(mediaLabel(matched)).toBe('The Matrix (1999)')
    expect(cardTitle(matched)).toEqual({ title: 'The Matrix', year: 1999 })
  })

  it("name a split movie's card by its cut after the title", () => {
    const split = mediaItem({
      variant: 'Final Cut',
      item: itemSummary({ title: 'Alexander', year: 2004 }),
    })
    expect(cardTitle(split)).toEqual({ title: 'Alexander (Final Cut)', year: 2004 })
  })

  it('fall back to the parsed title and year', () => {
    const parsed = mediaItem({ title: 'Heat', year: 1995 })
    expect(mediaLabel(parsed)).toBe('Heat (1995)')
    expect(cardTitle(parsed)).toEqual({ title: 'Heat', year: 1995 })
    expect(mediaLabel(mediaItem({ title: 'Clip' }))).toBe('Clip')
  })
  it('name an episode by its show and number as well, with no year', () => {
    const episode = mediaItem({
      item: itemSummary({
        type: ITEM_TYPES.episode,
        title: 'Lost / Found',
        year: 2024,
        show: { id: 3, title: 'The Acolyte' },
        season: 1,
        episode: 1,
      }),
    })
    expect(cardTitle(episode)).toEqual({ title: mediaLabel(episode), year: null })
    expect(cardTitle(episode).title).toContain('The Acolyte')
  })
})

describe('episodePlace', () => {
  const episode = (season: number) =>
    mediaItem({
      item: itemSummary({
        type: ITEM_TYPES.episode,
        show: { id: 3, title: 'The Acolyte' },
        season,
        episode: 4,
      }),
    })

  it('names the season and episode, and a special by its number alone', () => {
    expect(episodePlace(episode(2))).toBe('Season 2, Episode 4')
    expect(episodePlace(episode(0))).toBe('Special 4')
  })

  it('names nothing for a film or an unmatched file', () => {
    expect(episodePlace(mediaItem({ item: itemSummary() }))).toBeNull()
    expect(episodePlace(mediaItem({ title: 'Clip' }))).toBeNull()
  })
})

describe('primaryVersion', () => {
  it('plays the version with a saved spot, else the best, and nothing without a version', () => {
    const best = mediaItem({ id: 1 })
    const resumed = mediaItem({ id: 2, position: 600 })
    expect(primaryVersion([best, resumed])).toBe(resumed)
    expect(primaryVersion([best, mediaItem({ id: 3 })])).toBe(best)
    expect(primaryVersion([])).toBeUndefined()
  })
})

describe('tileWords', () => {
  const episode = (overrides: Partial<Parameters<typeof itemSummary>[0]> = {}) =>
    mediaItem({
      item: itemSummary({
        type: ITEM_TYPES.episode,
        title: 'Half Loop',
        year: 2022,
        show: { id: 4, title: 'Severance' },
        season: 1,
        episode: 2,
        ...overrides,
      }),
    })

  it('names an episode by its show, with its number and title under it', () => {
    expect(tileWords(episode())).toEqual({ title: 'Severance', line: 'S01E02 · Half Loop' })
  })

  it('names a movie by its title, with its year under it', () => {
    const movie = mediaItem({ item: itemSummary({ title: 'Busboys', year: 2026 }) })
    expect(tileWords(movie)).toEqual({ title: 'Busboys', line: '2026' })
  })

  it('has no line for a file with no year, nor for an episode with nothing to say', () => {
    expect(tileWords(mediaItem({ title: 'Clip', year: null }))).toEqual({
      title: 'Clip',
      line: null,
    })
    expect(tileWords(episode({ title: '', season: null, episode: null }))).toEqual({
      title: 'Severance',
      line: null,
    })
  })
})
