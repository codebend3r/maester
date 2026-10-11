import { describe, expect, it } from 'vitest'
import {
  cardTitle,
  episodeCode,
  formatScore,
  itemLabel,
  mediaLabel,
  pickScore,
  primaryVersion,
} from '@/items'
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
          type: 'episode',
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

  it('fall back to the parsed title and year', () => {
    const parsed = mediaItem({ title: 'Heat', year: 1995 })
    expect(mediaLabel(parsed)).toBe('Heat (1995)')
    expect(cardTitle(parsed)).toEqual({ title: 'Heat', year: 1995 })
    expect(mediaLabel(mediaItem({ title: 'Clip' }))).toBe('Clip')
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
