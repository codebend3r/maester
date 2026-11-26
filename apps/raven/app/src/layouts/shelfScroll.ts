/** Where a shelf stands in its screen's scrolling content: its top and its height. */
export type ShelfBand = { top: number; height: number }

/** What the shelves show of their content: how far they are scrolled and how tall the view is. */
export type ShelfViewport = { offset: number; viewport: number }

type ScrollTargetOfProps = ShelfViewport & {
  band: ShelfBand
  /** Room kept between the shelf and the view's edge, so a grown card and the title breathe. */
  margin: number
}

/**
 * How far the shelves scroll so the shelf `band` stands whole in view, as the focus engine would
 * scroll for a card it focused: as little as it takes, so one above comes to the top and one
 * below comes up to the foot, a shelf taller than the view by its top. Nothing while the view is
 * unmeasured or the shelf is in view already.
 */
export const scrollTargetOf = ({
  band,
  offset,
  viewport,
  margin,
}: ScrollTargetOfProps): number | null => {
  if (viewport <= 0) return null
  const top = band.top - margin
  const bottom = band.top + band.height + margin
  const isAbove = top < offset
  const isBelow = bottom > offset + viewport
  if (!isAbove && !isBelow) return null
  if (isAbove || bottom - top > viewport) return Math.max(0, top)
  return Math.max(0, bottom - viewport)
}

/** How far past the view, in screens, a shelf stays drawn, so the remote always finds the next one. */
const SCREENS_AROUND = 0.5

type FarHeightOfProps = ShelfViewport & { band: ShelfBand | null }

/**
 * The height a shelf stands in as, an empty box, while it lies more than `SCREENS_AROUND`
 * screens from the view; null while it is near, not laid out yet, or the view is unmeasured.
 */
export const farHeightOf = ({ band, offset, viewport }: FarHeightOfProps): number | null => {
  if (band === null || viewport <= 0) return null
  const reach = viewport * SCREENS_AROUND
  const isAbove = band.top + band.height < offset - reach
  const isBelow = band.top > offset + viewport + reach
  return isAbove || isBelow ? band.height : null
}
