import { INTERSECTION_REPORTING, watchIntersections } from '@tooling/web/intersection'
import { sizeWindow } from '@tooling/web/viewport'

export { moveOnScreen, reported, startOnScreen } from '@tooling/web/intersection'

/*
 * happy-dom's IntersectionObserver never reports, so no picture that waits for the screen would
 * ever load. The fake reports every element it is given as on the screen, as a page short enough
 * to show it all would, unless a test says otherwise (`startOnScreen`, `moveOnScreen`).
 */
watchIntersections({ reporting: INTERSECTION_REPORTING.onObserve })

/**
 * Makes the window `width` pixels wide, so media queries answer as a phone's
 * would, and returns what puts it back. happy-dom lays nothing out, so a
 * width test checks what renders and what the queries say; the layout itself
 * is checked in a browser.
 */
export const atViewportWidth = (width: number): (() => void) => {
  const before = { width: window.innerWidth, height: window.innerHeight }
  sizeWindow({ width, height: before.height })
  return () => sizeWindow(before)
}
