/** How tall the app sets a line of text for its size: `lineHeight` is the size times this. */
export const LINE_RATIO = 1.25

type LinesHeightOfProps = {
  sizes: readonly number[]
  fontScale: number
}

/**
 * How tall lines of these sizes stand, one each, at the text size the viewer set. React
 * Native scales both a font's size and its line height by `fontScale`, so a row holding them
 * must grow with it.
 */
export const linesHeightOf = ({ sizes, fontScale }: LinesHeightOfProps): number =>
  sizes.reduce((height, size) => height + size * LINE_RATIO * fontScale, 0)
