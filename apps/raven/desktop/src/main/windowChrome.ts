import {
  WINDOW_ACTIONS,
  WINDOW_CHROMES,
  WINDOW_EDGES,
  type WindowAction,
  type WindowChrome,
  type WindowEdge,
} from '@raven/core'
import type { BaseWindow, BrowserWindowConstructorOptions, Point, Rectangle } from 'electron'

const TITLE_BAR_STYLES = { hiddenInset: 'hiddenInset' } as const

type ChromeOptionsForProps = {
  chrome: WindowChrome
}

/**
 * The window options each chrome needs. macOS keeps its traffic lights over a page that runs
 * under the title bar. Windows composites mpv's video under the page only in a transparent
 * window, and a transparent window cannot have a frame, so the page draws the controls.
 */
export const chromeOptionsFor = ({
  chrome,
}: ChromeOptionsForProps): BrowserWindowConstructorOptions => {
  switch (chrome) {
    case WINDOW_CHROMES.inset:
      return { titleBarStyle: TITLE_BAR_STYLES.hiddenInset }
    case WINDOW_CHROMES.drawn:
      return { frame: false, transparent: true }
    default: {
      const unreachable: never = chrome
      return unreachable
    }
  }
}

type ControlWindowProps = {
  window: Pick<BaseWindow, 'minimize' | 'maximize' | 'unmaximize' | 'isMaximized' | 'close'>
  action: WindowAction
}

/** What a page-drawn control does to the window. */
export const controlWindow = ({ window, action }: ControlWindowProps): void => {
  switch (action) {
    case WINDOW_ACTIONS.minimize:
      return window.minimize()
    case WINDOW_ACTIONS.maximize:
      return window.isMaximized() ? window.unmaximize() : window.maximize()
    case WINDOW_ACTIONS.close:
      return window.close()
    default: {
      const unreachable: never = action
      return unreachable
    }
  }
}

type Side = -1 | 0 | 1

/** Which way each edge moves a side: -1 the left or top one, 1 the right or bottom one. */
const EDGE_SIDES = {
  [WINDOW_EDGES.top]: { x: 0, y: -1 },
  [WINDOW_EDGES.right]: { x: 1, y: 0 },
  [WINDOW_EDGES.bottom]: { x: 0, y: 1 },
  [WINDOW_EDGES.left]: { x: -1, y: 0 },
  [WINDOW_EDGES.topLeft]: { x: -1, y: -1 },
  [WINDOW_EDGES.topRight]: { x: 1, y: -1 },
  [WINDOW_EDGES.bottomRight]: { x: 1, y: 1 },
  [WINDOW_EDGES.bottomLeft]: { x: -1, y: 1 },
} as const satisfies Record<WindowEdge, { x: Side; y: Side }>

type ResizedSpanProps = {
  side: Side
  start: number
  length: number
  delta: number
  minimum: number
}

/** One axis of a resize: the side the edge drags moves by the delta, the other stays put. */
const resizedSpan = ({ side, start, length, delta, minimum }: ResizedSpanProps) => {
  const resized = Math.max(minimum, length + side * delta)
  return { start: side === -1 ? start + length - resized : start, length: resized }
}

type ResizedBoundsProps = {
  edge: WindowEdge
  start: Rectangle
  from: Point
  to: Point
  minimum: { width: number; height: number }
}

/** The window's bounds once the edge a drag holds has followed the pointer from `from` to `to`. */
export const resizedBounds = ({
  edge,
  start,
  from,
  to,
  minimum,
}: ResizedBoundsProps): Rectangle => {
  const sides = EDGE_SIDES[edge]
  const x = resizedSpan({
    side: sides.x,
    start: start.x,
    length: start.width,
    delta: to.x - from.x,
    minimum: minimum.width,
  })
  const y = resizedSpan({
    side: sides.y,
    start: start.y,
    length: start.height,
    delta: to.y - from.y,
    minimum: minimum.height,
  })
  return { x: x.start, y: y.start, width: x.length, height: y.length }
}

type ResizableWindow = Pick<
  BaseWindow,
  'getBounds' | 'setBounds' | 'getMinimumSize' | 'isMaximized' | 'isFullScreen'
>

/** A drag on a page-drawn resize handle: the edge it holds and where, on screen, it began. */
export type WindowResizeStart = { edge: WindowEdge; at: Point }

/** Where, on screen, a resize drag has got to. */
export type WindowResizeMove = { to: Point }

type StartResizeProps = WindowResizeStart & { window: ResizableWindow }

type MoveResizeProps = WindowResizeMove & { window: ResizableWindow }

/**
 * A transparent window on Windows has no native resize border, so the page's edge handles
 * drag it: a drag remembers the bounds it started from and each move sets them again from
 * there. A maximized or full screen window does not resize from its edges.
 */
export const createWindowResizer = () => {
  let drag: { edge: WindowEdge; start: Rectangle; from: Point } | null = null
  return {
    start: ({ window, edge, at }: StartResizeProps): void => {
      drag =
        window.isMaximized() || window.isFullScreen()
          ? null
          : { edge, start: window.getBounds(), from: at }
    },
    move: ({ window, to }: MoveResizeProps): void => {
      if (drag === null) return
      const [width = 0, height = 0] = window.getMinimumSize()
      window.setBounds(resizedBounds({ ...drag, to, minimum: { width, height } }))
    },
  }
}
