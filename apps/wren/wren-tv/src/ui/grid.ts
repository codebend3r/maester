type ColumnsFittingProps = {
  /** The width the grid has, between its gutters. */
  width: number
  /** One tile's width. */
  tile: number
  /** The gap between two tiles. */
  gap: number
}

/** How many tiles of `tile` width fit in `width` with `gap` between each, at least one. */
export const columnsFitting = ({ width, tile, gap }: ColumnsFittingProps): number =>
  Math.max(1, Math.floor((width + gap) / (tile + gap)))
