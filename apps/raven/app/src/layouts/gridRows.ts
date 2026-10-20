import type { CardShape, ShelfCard } from '@/queries/cards'
import type { GridSection } from '@/queries/libraryGrid'

/** A grid as a list draws it: one row at a time, a bucket's heading or a run of cards. */
export const GRID_ROWS = { header: 'header', cards: 'cards' } as const

export type GridRow =
  | { kind: typeof GRID_ROWS.header; key: string; section: GridSection; isOpen: boolean }
  | { kind: typeof GRID_ROWS.cards; key: string; shape: CardShape; cards: ShelfCard[] }

/** As many columns of at least `least` as fit in `width` with `gap` between them, and never none. */
export const columnsFor = ({
  width,
  least,
  gap,
}: {
  width: number
  least: number
  gap: number
}): number => Math.max(1, Math.floor((width + gap) / (least + gap)))

/** Whether a section folds: a bucket does, and the untitled run of a plain grid never. */
export const isBucket = (section: GridSection): boolean => section.title !== null

const cardRows = ({ section, columns }: { section: GridSection; columns: number }): GridRow[] =>
  Array.from({ length: Math.ceil(section.cards.length / columns) }, (_, at) => ({
    kind: GRID_ROWS.cards,
    key: `${section.key}:${at}`,
    shape: section.shape,
    cards: section.cards.slice(at * columns, (at + 1) * columns),
  }))

/** The rows of a grid: each bucket's heading, then its cards when it is open, `columnsOf` to a row. */
export const gridRowsOf = ({
  sections,
  open,
  columnsOf,
}: {
  sections: readonly GridSection[]
  open: ReadonlySet<string>
  columnsOf: (shape: CardShape) => number
}): GridRow[] =>
  sections.flatMap((section) => {
    const cards = cardRows({ section, columns: columnsOf(section.shape) })
    if (!isBucket(section)) return cards
    const isOpen = open.has(section.key)
    const header: GridRow = { kind: GRID_ROWS.header, key: section.key, section, isOpen }
    return isOpen ? [header, ...cards] : [header]
  })

/** The first card the grid shows of those under a jump mark, and the section it is in. */
export const jumpTargetOf = ({
  sections,
  keys,
}: {
  sections: readonly GridSection[]
  keys: ReadonlySet<string>
}): { section: string; card: string } | null =>
  sections
    .flatMap((section) => section.cards.map((card) => ({ section: section.key, card: card.key })))
    .find(({ card }) => keys.has(card)) ?? null

/** How far down the list row `index` starts, its rows being of fixed heights. */
export const offsetOfRow = ({
  rows,
  index,
  heightOf,
}: {
  rows: readonly GridRow[]
  index: number
  heightOf: (row: GridRow) => number
}): number => rows.slice(0, index).reduce((offset, row) => offset + heightOf(row), 0)
