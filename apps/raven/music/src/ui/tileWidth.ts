type TileWidthOfProps = { width: number; columns: number; gap: number }

/** Each tile's width, `columns` to a row of `width` with `gap` between them, in whole points. */
export const tileWidthOf = ({ width, columns, gap }: TileWidthOfProps): number =>
  Math.max(0, Math.floor((width - (columns - 1) * gap) / columns))

type ColumnsFittingProps = { width: number; tile: number; gap: number }

/** How many tiles of `tile` points, with `gap` between them, fit across `width`: one at least. */
export const columnsFitting = ({ width, tile, gap }: ColumnsFittingProps): number =>
  Math.max(1, Math.floor((width + gap) / (tile + gap)))
