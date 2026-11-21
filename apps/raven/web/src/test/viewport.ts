import { INTERSECTION_REPORTING, watchIntersections } from '@tooling/web/intersection'

export { moveOnScreen, reported, startOnScreen } from '@tooling/web/intersection'

/*
 * happy-dom's IntersectionObserver never reports, so no picture that waits for the screen would
 * ever load. The fake reports every element it is given as on the screen, as a page short enough
 * to show it all would, unless a test says otherwise (`startOnScreen`, `moveOnScreen`).
 */
watchIntersections({ reporting: INTERSECTION_REPORTING.onObserve })

/** What happy-dom's window adds for a test to size the window. */
type HappyDomViewport = { setViewport: (size: { width: number; height: number }) => void }

const isHappyDomViewport = (value: unknown): value is HappyDomViewport =>
  typeof value === 'object' &&
  value !== null &&
  'setViewport' in value &&
  typeof value.setViewport === 'function'

/**
 * Makes the window `width` pixels wide, so media queries answer as a phone's
 * would, and returns what puts it back. happy-dom lays nothing out, so a
 * width test checks what renders and what the queries say; the layout itself
 * is checked in a browser.
 */
export const atViewportWidth = (width: number): (() => void) => {
  const happyDom: unknown = Reflect.get(window, 'happyDOM')
  if (!isHappyDomViewport(happyDom)) throw new Error('happy-dom cannot size this window')
  const before = { width: window.innerWidth, height: window.innerHeight }
  happyDom.setViewport({ width, height: before.height })
  return () => happyDom.setViewport(before)
}
