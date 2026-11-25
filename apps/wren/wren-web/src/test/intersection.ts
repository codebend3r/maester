import { INTERSECTION_REPORTING, watchIntersections as watch } from '@tooling/web/intersection'

export { reachEnds } from '@tooling/web/intersection'

/**
 * Puts a fake IntersectionObserver in the browser's place, one that reports nothing until
 * `reachEnds` says the page was scrolled, and returns what puts the browser's back; call it before
 * a list that pages renders, and the return after `cleanup()`.
 */
export const watchIntersections = (): (() => void) =>
  watch({ reporting: INTERSECTION_REPORTING.onDemand })
