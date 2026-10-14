/** Frames in a row the card has to stay put before the hold lets go. */
const STILL_FRAMES = 3
/** Frames a smooth scroll gets to start moving before the hold stops waiting on it. */
const START_FRAMES = 10
/** The longest a hold lasts, about three seconds, so one can never run on. */
const MOST_FRAMES = 180
/** What a viewer scrolls with. Any of it ends a hold, which never fights them. */
const VIEWER_INPUT = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const

type Hold = {
  frames: number
  still: number
  hasMoved: boolean
  /** How far the page was scrolled at the end of the frame before. */
  y: number
}

/**
 * Keeps `card` `top` px from the top of the screen while the cards around
 * it are drawn. A grid skips its offscreen cards (`content-visibility`),
 * each standing in at an estimate of its height until drawn, so drawing
 * those above a card moves it. Each frame scrolls it back, until it has held
 * still a few frames, or the viewer scrolls. With `afterScroll` it waits
 * out a smooth scroll first, which would carry the card off again. What it
 * returns stops it sooner.
 */
export const holdInPlace = ({
  card,
  top,
  afterScroll = false,
}: {
  card: Element
  top: number
  afterScroll?: boolean
}): (() => void) => {
  const viewer = new AbortController()
  VIEWER_INPUT.forEach((type) =>
    window.addEventListener(type, () => viewer.abort(), { passive: true, signal: viewer.signal }),
  )

  const step = (hold: Hold): void => {
    const isDone =
      viewer.signal.aborted ||
      !card.isConnected ||
      hold.still >= STILL_FRAMES ||
      hold.frames >= MOST_FRAMES
    if (isDone) {
      viewer.abort()
      return
    }
    const before = window.scrollY
    const isScrolling = before !== hold.y
    const hasMoved = hold.hasMoved || isScrolling
    const isWaiting = afterScroll && (isScrolling || (!hasMoved && hold.frames < START_FRAMES))
    if (isWaiting) {
      window.requestAnimationFrame(() =>
        step({ frames: hold.frames + 1, still: 0, hasMoved, y: before }),
      )
      return
    }
    const off = card.getBoundingClientRect().top - top
    if (Math.abs(off) >= 1) window.scrollBy({ top: off, behavior: 'instant' })
    const after = window.scrollY
    window.requestAnimationFrame(() =>
      step({
        frames: hold.frames + 1,
        still: after === before ? hold.still + 1 : 0,
        hasMoved,
        y: after,
      }),
    )
  }

  const start = window.scrollY
  window.requestAnimationFrame(() => step({ frames: 0, still: 0, hasMoved: false, y: start }))
  return () => viewer.abort()
}
