/** How far down a page is scrolled, in points, before the way back to its top is offered. */
const AWAY_AFTER = 160

/** Whether a page scrolled to `offset` has left its top, and the header's buttons, behind. */
export const isScrolledAway = (offset: number): boolean => offset > AWAY_AFTER
