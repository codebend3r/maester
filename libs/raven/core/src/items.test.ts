import { formatAirDate } from '@/itemFacts'
import { describe, expect, it } from 'bun:test'
import {
  artItemIdOf,
  cardTitle,
  episodeCode,
  episodeLine,
  episodePlace,
  episodeTag,
  formatScore,
  itemLabel,
  mediaLabel,
  pickScore,
  primaryVersion,
  tileWords,
} from '@/items'
import { ITEM_TYPES } from '@/contract'
import { RELEASED_LABEL, itemSummary, mediaItem } from '@/test/fixtures'

describe('episodeCode', () => {
  it('pads seasons and episodes to two digits, and keeps three', () => {
    expect(episodeCode({ season: 1, episode: 2 })).toBe('S01E02')
    expect(episodeCode({ season: 1, episode: 123 })).toBe('S01E123')
    expect(episodeCode({ season: 0, episode: null })).toBe('S00')
    expect(episodeCode({ season: null, episode: 3 })).toBeNull()
  })
})

describe('episodeTag', () => {
  it('sets the season and episode apart with a dot, and gives a season alone its mark', () => {
    expect(episodeTag({ season: 1, episode: 2 })).toBe('S01 · E02')
    expect(episodeTag({ season: 1, episode: 123 })).toBe('S01 · E123')
    expect(episodeTag({ season: 2, episode: null })).toBe('S02')
    expect(episodeTag({ season: null, episode: 3 })).toBeNull()
  })

  it('names a special and the specials in words', () => {
    expect(episodeTag({ season: 0, episode: 5 })).toBe('Special 5')
    expect(episodeTag({ season: 0, episode: null })).toBe('Specials')
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
    expect(cardTitle(matched)).toEqual({ title: 'The Matrix', date: RELEASED_LABEL })
  })

  it("name a split movie's card by its cut after the title", () => {
    const split = mediaItem({
      variant: 'Final Cut',
      item: itemSummary({ title: 'Alexander', year: 2004 }),
    })
    expect(cardTitle(split)).toEqual({ title: 'Alexander (Final Cut)', date: RELEASED_LABEL })
  })

  it('fall back to the parsed title and year', () => {
    const parsed = mediaItem({ title: 'Heat', year: 1995 })
    expect(mediaLabel(parsed)).toBe('Heat (1995)')
    expect(cardTitle(parsed)).toEqual({ title: 'Heat', date: '1995' })
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
    expect(cardTitle(episode)).toEqual({ title: mediaLabel(episode), date: null })
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

describe('episodeLine', () => {
  it('joins the code and the title, and leaves out whichever is missing', () => {
    expect(episodeLine({ season: 1, episode: 2, title: 'Half Loop' })).toBe('S01E02 · Half Loop')
    expect(episodeLine({ season: null, episode: 2, title: 'Half Loop' })).toBe('Half Loop')
    expect(episodeLine({ season: 1, episode: 2, title: '' })).toBe('S01E02')
    expect(episodeLine({ season: null, episode: null, title: '' })).toBeNull()
  })
})

describe('artItemIdOf', () => {
  it("gives an episode or season its show's art, and a film or show its own", () => {
    expect(artItemIdOf(itemSummary({ id: 6, show: { id: 4, title: 'Severance' } }))).toBe(4)
    expect(artItemIdOf(itemSummary({ id: 1, show: null }))).toBe(1)
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

  it('names a movie by its title, with its release day under it, or its year when that is all it has', () => {
    const dated = mediaItem({
      item: itemSummary({ title: 'Busboys', year: 2026, released: '2026-03-06' }),
    })
    expect(tileWords(dated)).toEqual({ title: 'Busboys', line: formatAirDate('2026-03-06') })
    const movie = mediaItem({
      item: itemSummary({ title: 'Busboys', year: 2026, released: null }),
    })
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
