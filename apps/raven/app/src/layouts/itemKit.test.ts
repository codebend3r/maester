import { describe, expect, it } from 'bun:test'

import { CARD_SHAPES } from '@/queries/cards'
import type { EpisodeRow } from '@/queries/itemPage'
import { episodeLabelOf } from '@/layouts/itemKit'
import { itemTarget } from '@/routes'

const row = (overrides: Partial<EpisodeRow> = {}): EpisodeRow => ({
  key: 'episode:8',
  title: 'E2 · Half Loop',
  line: '18 Feb 2022 · 55m',
  shape: CARD_SHAPES.wide,
  picture: null,
  progress: 0,
  target: itemTarget(8),
  summary: null,
  isWatched: false,
  ...overrides,
})

describe('episodeLabelOf', () => {
  it('reads an episode row out with its line, and whether it is watched', () => {
    expect(episodeLabelOf(row())).toBe('E2 · Half Loop, 18 Feb 2022 · 55m')
    expect(episodeLabelOf(row({ isWatched: true }))).toBe(
      'E2 · Half Loop, 18 Feb 2022 · 55m, Watched',
    )
    expect(episodeLabelOf(row({ line: null }))).toBe('E2 · Half Loop')
  })
})
