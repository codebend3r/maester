import { spyOn } from 'bun:test'

type Spot = { top: number; height: number }

/**
 * A page that scrolls with no layout behind it: each element placed sits at
 * its spot down the page, so its top on screen is that spot less the
 * scroll, as a browser would have it, and animation frames run only when
 * the test calls `frame`.
 */
export const pageWithoutLayout = () => {
  const queued: FrameRequestCallback[] = []
  const frames = spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    queued.push(callback)
    return queued.length
  })
  const spots = new Map<Element, Spot>()
  const rects = spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: Element,
  ) {
    const spot = spots.get(this) ?? { top: 0, height: 0 }
    return new DOMRect(0, spot.top - window.scrollY, 100, spot.height)
  })
  return {
    /** Puts `element` `top` px down the page, `height` tall. */
    place: ({ element, top, height = 300 }: { element: Element; top: number; height?: number }) => {
      spots.set(element, { top, height })
    },
    /** Scrolls the page to `y` as the browser would, with no call to scroll it. */
    scrollTo: (y: number) => {
      document.documentElement.scrollTop = y
    },
    /** Runs the frames asked for so far, then those they ask for in turn, `count` frames in all. */
    frame: (count = 1) => {
      Array.from({ length: count }).forEach(() =>
        queued.splice(0).forEach((callback) => callback(performance.now())),
      )
    },
    /** Whether anything waits on the next frame. */
    isWaiting: () => queued.length > 0,
    restore: () => {
      frames.mockRestore()
      rects.mockRestore()
      document.documentElement.scrollTop = 0
    },
  }
}
