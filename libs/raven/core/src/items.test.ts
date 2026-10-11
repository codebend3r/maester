import { describe, expect, it } from 'vitest'
import { cardTitle, episodeCode, itemLabel, mediaLabel } from '@/items'
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
