import type { ComponentType, PointerEvent } from 'react'
import {
  DESKTOP_REQUESTS,
  WINDOW_CHROMES,
  WINDOW_EDGES,
  type WindowChrome,
  type WindowEdge,
  windowChromeFor,
} from '@raven/core'
import { handled } from '@/desktop/handled'
import { useDesktop } from '@/stores/desktop'
import styles from '@/desktop/WindowEdges/WindowEdges.module.scss'

const EDGES = [
  { edge: WINDOW_EDGES.topLeft, className: styles.topLeft },
  { edge: WINDOW_EDGES.top, className: styles.top },
  { edge: WINDOW_EDGES.topRight, className: styles.topRight },
  { edge: WINDOW_EDGES.right, className: styles.right },
  { edge: WINDOW_EDGES.bottomRight, className: styles.bottomRight },
  { edge: WINDOW_EDGES.bottom, className: styles.bottom },
  { edge: WINDOW_EDGES.bottomLeft, className: styles.bottomLeft },
  { edge: WINDOW_EDGES.left, className: styles.left },
] as const satisfies readonly { edge: WindowEdge; className: string | undefined }[]

const PRIMARY_BUTTON = 0

/** The page draws the resize border itself. */
const DrawnEdges = () => {
  const { client } = useDesktop()

  const startResize = (edge: WindowEdge) => (event: PointerEvent<HTMLSpanElement>) => {
    if (event.button !== PRIMARY_BUTTON) return
    event.currentTarget.setPointerCapture(event.pointerId)
    handled(
      client.request({
        type: DESKTOP_REQUESTS.startWindowResize,
        edge,
        x: event.screenX,
        y: event.screenY,
      }),
    )
  }

  const moveResize = (event: PointerEvent<HTMLSpanElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    handled(
      client.request({
        type: DESKTOP_REQUESTS.moveWindowResize,
        x: event.screenX,
        y: event.screenY,
      }),
    )
  }

  return (
    <div className={styles.edges} aria-hidden="true">
      {EDGES.map(({ edge, className }) => (
        <span
          key={edge}
          className={[styles.handle, className].filter(Boolean).join(' ')}
          onPointerDown={startResize(edge)}
          onPointerMove={moveResize}
        />
      ))}
    </div>
  )
}

/** The system draws the window's frame, resize border included. */
const SystemEdges = () => null

const EDGES_BY_CHROME = {
  [WINDOW_CHROMES.inset]: SystemEdges,
  [WINDOW_CHROMES.drawn]: DrawnEdges,
} as const satisfies Record<WindowChrome, ComponentType>

/**
 * Resize handles along the edges and corners of a window with no frame, as on Windows,
 * where a transparent window has no native resize border. A drag captures the pointer, so
 * it keeps coming once the pointer leaves the window, and main resizes from screen points.
 */
export const WindowEdges = () => {
  const { client } = useDesktop()
  const Edges = EDGES_BY_CHROME[windowChromeFor({ platform: client.platform })]
  return <Edges />
}
