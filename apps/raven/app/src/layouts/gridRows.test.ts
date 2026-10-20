import { describe, expect, it } from 'bun:test'

import { CARD_SHAPES, type ShelfCard } from '@/queries/cards'
import type { GridSection } from '@/queries/libraryGrid'
import { GRID_ROWS, columnsFor, gridRowsOf, jumpTargetOf, offsetOfRow } from '@/layouts/gridRows'

const card = (key: string): ShelfCard => ({
  key,
  title: key,
  line: null,
  shape: CARD_SHAPES.poster,
  picture: null,
  progress: 0,
  itemId: null,
})

const section = ({
  key,
  title = null,
  cards,
}: {
  key: string
  title?: string | null
  cards: string[]
}): GridSection => ({
  key,
  title,
  count: title === null ? null : `${cards.length} videos`,
  shape: CARD_SHAPES.poster,
  cards: cards.map(card),
})

const keysOf = (rows: ReturnType<typeof gridRowsOf>) =>
  rows.map((row) =>
    row.kind === GRID_ROWS.header
      ? `[${row.section.key}]`
      : row.cards.map(({ key }) => key).join(' '),
  )

describe('columnsFor', () => {
  it('fits as many columns as the least width allows, with the gaps between them', () => {
    expect(columnsFor({ width: 358, least: 128, gap: 16 })).toBe(2)
    expect(columnsFor({ width: 400, least: 128, gap: 16 })).toBe(2)
    expect(columnsFor({ width: 416, least: 128, gap: 16 })).toBe(3)
    expect(columnsFor({ width: 1760, least: 232, gap: 32 })).toBe(6)
  })

  it('always fits one', () => {
    expect(columnsFor({ width: 100, least: 240, gap: 16 })).toBe(1)
  })
})

describe('gridRowsOf', () => {
  it('cuts an untitled section into rows of cards, with no heading', () => {
    const rows = gridRowsOf({
      sections: [section({ key: 'all', cards: ['a', 'b', 'c', 'd', 'e'] })],
      open: new Set(),
      columnsOf: () => 2,
    })
    expect(keysOf(rows)).toEqual(['a b', 'c d', 'e'])
  })

  it('heads each titled section, and shows the cards only of those open', () => {
    const rows = gridRowsOf({
      sections: [
        section({ key: 'one', title: 'One', cards: ['a', 'b', 'c'] }),
        section({ key: 'two', title: 'Two', cards: ['d'] }),
      ],
      open: new Set(['two']),
      columnsOf: () => 2,
    })
    expect(keysOf(rows)).toEqual(['[one]', '[two]', 'd'])
    expect(rows.flatMap((row) => (row.kind === GRID_ROWS.header ? [row.isOpen] : []))).toEqual([
      false,
      true,
    ])
  })
})

describe('jumpTargetOf', () => {
  const sections = [
    section({ key: 'one', title: 'One', cards: ['a', 'b'] }),
    section({ key: 'two', title: 'Two', cards: ['c', 'd'] }),
  ]

  it('finds the first card under a mark in the order the page shows them', () => {
    expect(jumpTargetOf({ sections, keys: new Set(['d', 'c']) })).toEqual({
      section: 'two',
      card: 'c',
    })
  })

  it('finds nothing for a mark no card is under', () => {
    expect(jumpTargetOf({ sections, keys: new Set(['z']) })).toBeNull()
  })
})

describe('offsetOfRow', () => {
  it('adds up the heights of the rows before it', () => {
    const rows = gridRowsOf({
      sections: [section({ key: 'one', title: 'One', cards: ['a', 'b', 'c'] })],
      open: new Set(['one']),
      columnsOf: () => 2,
    })
    const heightOf = (row: (typeof rows)[number]) => (row.kind === GRID_ROWS.header ? 50 : 300)
    expect([0, 1, 2].map((index) => offsetOfRow({ rows, index, heightOf }))).toEqual([0, 50, 350])
  })
})
