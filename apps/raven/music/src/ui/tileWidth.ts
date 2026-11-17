type TileWidthOfProps = { width: number; columns: number; gap: number }

/** Each tile's width, `columns` to a row of `width` with `gap` between them, in whole points. */
export const tileWidthOf = ({ width, columns, gap }: TileWidthOfProps): number =>
  Math.max(0, Math.floor((width - (columns - 1) * gap) / columns))
