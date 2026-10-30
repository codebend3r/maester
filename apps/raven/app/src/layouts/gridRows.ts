import type { CardShape, ShelfCard } from '@/queries/cards'
import type { GridSection } from '@/queries/libraryGrid'

/** A grid as a list draws it: one row at a time, a bucket's heading or a run of cards. */
export const GRID_ROWS = { header: 'header', cards: 'cards' } as const

export type GridRow =
  | { kind: typeof GRID_ROWS.header; key: string; section: GridSection; isOpen: boolean }
  | { kind: typeof GRID_ROWS.cards; key: string; shape: CardShape; cards: ShelfCard[] }

export type GridRowKind = GridRow['kind']

/** The row of one kind, as a grid's row component for that kind draws it. */
export type GridRowOf<K extends GridRowKind> = Extract<GridRow, { kind: K }>

type GridColumnsOfProps = {
  room: number
  gap: number
  leastOf: (shape: CardShape) => number
}

/**
 * How a grid `room` points wide lays out each shape of card: in as many columns of at least
 * `leastOf` it as fit with `gap` between them, and never none, each card as wide as its share.
 */
export const gridColumnsOf = ({ room, gap, leastOf }: GridColumnsOfProps) => {
  const columnsOf = (shape: CardShape): number =>
    Math.max(1, Math.floor((room + gap) / (leastOf(shape) + gap)))
  const widthOf = (shape: CardShape): number => {
    const columns = columnsOf(shape)
    return (room - (columns - 1) * gap) / columns
  }
  return { columnsOf, widthOf }
}

/** Whether a section folds: a bucket does, and the untitled run of a plain grid never. */
export const isBucket = (section: GridSection): boolean => section.title !== null

type CardRowsProps = { section: GridSection; columns: number }

const cardRows = ({ section, columns }: CardRowsProps): GridRow[] =>
  Array.from({ length: Math.ceil(section.cards.length / columns) }, (_, at) => ({
    kind: GRID_ROWS.cards,
    key: `${section.key}:${at}`,
    shape: section.shape,
    cards: section.cards.slice(at * columns, (at + 1) * columns),
  }))

type GridRowsOfProps = {
  sections: readonly GridSection[]
  open: ReadonlySet<string>
  columnsOf: (shape: CardShape) => number
}

/**
 * The rows of a grid: each bucket's heading, then its cards when it is open, `columnsOf` to a row.
 */
export const gridRowsOf = ({ sections, open, columnsOf }: GridRowsOfProps): GridRow[] =>
  sections.flatMap((section) => {
    const cards = cardRows({ section, columns: columnsOf(section.shape) })
    if (!isBucket(section)) return cards
    const isOpen = open.has(section.key)
    const header: GridRow = { kind: GRID_ROWS.header, key: section.key, section, isOpen }
    return isOpen ? [header, ...cards] : [header]
  })

type JumpTargetOfProps = {
  sections: readonly GridSection[]
  keys: ReadonlySet<string>
}

/** The first card the grid shows of those under a jump mark, and the section it is in. */
export const jumpTargetOf = ({
  sections,
  keys,
}: JumpTargetOfProps): { section: string; card: string } | null =>
  sections
    .flatMap((section) => section.cards.map((card) => ({ section: section.key, card: card.key })))
    .find(({ card }) => keys.has(card)) ?? null

type RowOffsetsOfProps = {
  rows: readonly GridRow[]
  heightOf: (row: GridRow) => number
}

/**
 * How far down the list each row starts, its rows being of fixed heights, and after the last
 * the list's whole height: one more entry than rows, so row `i` runs from entry `i` to `i + 1`.
 */
export const rowOffsetsOf = ({ rows, heightOf }: RowOffsetsOfProps): number[] =>
  rows.reduce(
    (offsets, row) => {
      // The array is this call's own, so growing it in place keeps the sum linear.
      offsets.push((offsets.at(-1) ?? 0) + heightOf(row))
      return offsets
    },
    [0],
  )
