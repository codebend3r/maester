type LineScrollOfProps = {
  /** Where the line starts in the box's content. */
  y: number
  /** The line's height. */
  height: number
  /** The height of the box the lines scroll in. */
  box: number
}

/** Where the lyrics' box scrolls to put a line in its middle, never above its top. */
export const lineScrollOf = ({ y, height, box }: LineScrollOfProps): number =>
  Math.max(0, y - (box - height) / 2)
