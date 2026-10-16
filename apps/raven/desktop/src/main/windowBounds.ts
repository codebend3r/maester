import type { WindowBounds } from '@/main/playerState'

export type Rect = { x: number; y: number; width: number; height: number }

export const DEFAULT_SIZE = { width: 1280, height: 800 } as const

// Enough of the window to grab and drag back, so bounds left mostly off screen are not reused.
const MIN_VISIBLE = 64

const overlap = ({ a, b }: { a: Rect; b: Rect }): { width: number; height: number } => ({
  width: Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
  height: Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
})

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

/** The window opens where it closed, or centred on the main display if that display is gone. */
export const placeWindow = ({
  saved,
  displays,
  primary,
}: {
  saved: WindowBounds | null
  displays: readonly { id: number; workArea: Rect }[]
  primary: { workArea: Rect }
}): Rect => {
  if (saved === null) return centred(primary.workArea)
  const display = displays.find(({ id }) => id === saved.displayId)
  if (display === undefined) return centred(primary.workArea)
  const visible = overlap({ a: saved, b: display.workArea })
  if (visible.width < MIN_VISIBLE || visible.height < MIN_VISIBLE) {
    return centred(primary.workArea)
  }
  return {
    x: saved.x,
    y: saved.y,
    width: Math.min(saved.width, display.workArea.width),
    height: Math.min(saved.height, display.workArea.height),
  }
}
