import { describe, expect, it } from 'bun:test'
import { ITEM_TYPES } from '@raven/core'

import { cardMarkOf, episodeWordsOf } from '@/queries/episodeMark'
import { mediaItemFor, summaryFor } from '@/test/mediaItem'

describe('cardMarkOf', () => {
  it('writes the season, a dot and the episode, unpadded, on one line', () => {
    expect(cardMarkOf({ season: 5, episode: 1 })).toBe('S5.E1')
    expect(cardMarkOf({ season: 12, episode: 10 })).toBe('S12.E10')
  })

  it('writes a season alone, a special as the pages do, and nothing without a season', () => {
    expect(cardMarkOf({ season: 2, episode: null })).toBe('S2')
    expect(cardMarkOf({ season: 0, episode: 3 })).toBe('Special 3')
    expect(cardMarkOf({ season: null, episode: 3 })).toBeNull()
  })
})

describe('episodeWordsOf', () => {
  const EPISODE = summaryFor({
    id: 9,
    type: ITEM_TYPES.episode,
    title: 'Dear Reader',
    show: { id: 3, title: "The Handmaid's Tale" },
    season: 5,
    episode: 1,
  })

  it("names an episode by its own title and its S5.E1 place, not its show's", () => {
    expect(episodeWordsOf(mediaItemFor({ item: EPISODE }))).toEqual({
      name: 'Dear Reader',
      mark: 'S5.E1',
    })
  })

  it('falls back on the file title for an episode with no name, and none for a film', () => {
    expect(
      episodeWordsOf(mediaItemFor({ title: 'Episode 1', item: { ...EPISODE, title: '' } }))?.name,
    ).toBe('Episode 1')
    expect(episodeWordsOf(mediaItemFor({ item: summaryFor({ id: 1, title: 'Dune' }) }))).toBeNull()
  })
})
