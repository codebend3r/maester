import type { WindowBounds } from '@/main/playerState'

export type Rect = { x: number; y: number; width: number; height: number }

export const DEFAULT_SIZE = { width: 1280, height: 800 } as const

// Enough of the window to grab and drag back, so bounds left mostly off screen are not reused.
const MIN_VISIBLE = 64

type OverlapProps = { a: Rect; b: Rect }

const overlap = ({ a, b }: OverlapProps): { width: number; height: number } => ({
  width: Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
  height: Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
})

type WithinProps = {
  start: number
  length: number
  area: number
  areaLength: number
}

/** Moves a span that fits in the area so it lies wholly inside it. */
const within = ({ start, length, area, areaLength }: WithinProps): number =>
  Math.min(Math.max(start, area), area + areaLength - length)

const centred = (workArea: Rect): Rect => {
  const width = Math.min(DEFAULT_SIZE.width, workArea.width)
  const height = Math.min(DEFAULT_SIZE.height, workArea.height)
  return {
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2),
    width,
    height,
  }
}

type PlaceWindowProps = {
  saved: WindowBounds | null
  displays: readonly { id: number; workArea: Rect }[]
  primary: { workArea: Rect }
}

/** The window opens where it closed, or centred on the main display if that display is gone. */
export const placeWindow = ({ saved, displays, primary }: PlaceWindowProps): Rect => {
  if (saved === null) return centred(primary.workArea)
  const display = displays.find(({ id }) => id === saved.displayId)
  if (display === undefined) return centred(primary.workArea)
  // Checked after clamping: a window wider than its display shrinks from the right, so
  // the clamped rect, not the saved one, is what has to stay on screen.
  const clamped = {
    x: saved.x,
    y: saved.y,
    width: Math.min(saved.width, display.workArea.width),
    height: Math.min(saved.height, display.workArea.height),
  }
  const visible = overlap({ a: clamped, b: display.workArea })
  if (visible.width < MIN_VISIBLE || visible.height < MIN_VISIBLE) {
    return centred(primary.workArea)
  }
  // A window that overlaps by enough may still sit above the top, its title bar out of reach.
  return {
    ...clamped,
    x: within({
      start: clamped.x,
      length: clamped.width,
      area: display.workArea.x,
      areaLength: display.workArea.width,
    }),
    y: within({
      start: clamped.y,
      length: clamped.height,
      area: display.workArea.y,
      areaLength: display.workArea.height,
    }),
  }
}
