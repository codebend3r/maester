import { createThrottle } from '@/main/player/throttle'
import type { Timers } from '@/main/timers'

export const BUFFERED_MS = 1000

/** How far a buffered range edge must move before the page hears of it. */
const BUFFERED_STEP_S = 0.5

type Range = { start: number; end: number }

type HasMovedProps = { shown: readonly Range[] | null; next: readonly Range[] }

const hasMoved = ({ shown, next }: HasMovedProps): boolean =>
  shown === null ||
  shown.length !== next.length ||
  next.some((range, position) => {
    const before = shown[position]
    if (before === undefined) return true
    return (
      Math.abs(range.start - before.start) >= BUFFERED_STEP_S ||
      Math.abs(range.end - before.end) >= BUFFERED_STEP_S
    )
  })

type CreateBufferedRangesProps = {
  timers: Timers
  show: (ranges: Range[]) => void
}

export type BufferedRanges = {
  push: (ranges: readonly Range[]) => void
  clear: () => void
}

/** What mpv has buffered, at most once a `BUFFERED_MS`, and only once an edge has moved. */
export const createBufferedRanges = ({
  timers,
  show,
}: CreateBufferedRangesProps): BufferedRanges => {
  let shown: readonly Range[] | null = null
  const throttle = createThrottle<readonly Range[]>({
    timers,
    ms: BUFFERED_MS,
    show: (ranges) => {
      if (!hasMoved({ shown, next: ranges })) return false
      shown = ranges
      show(ranges.map(({ start, end }) => ({ start, end })))
      return true
    },
  })
  return {
    push: throttle.push,
    clear: () => {
      throttle.clear()
      shown = null
    },
  }
}
