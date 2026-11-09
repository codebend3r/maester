import type { ShelfBand } from '@/stores/shelfBands'

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
