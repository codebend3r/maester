import { useRef, useState } from 'react'
import type {
  LayoutChangeEvent,
  LayoutRectangle,
  NativeScrollEvent,
  NativeSyntheticEvent,
} from 'react-native'

/** Which way the list being windowed scrolls. */
export const SCROLL_AXES = { vertical: 'vertical', horizontal: 'horizontal' } as const

type ScrollAxis = (typeof SCROLL_AXES)[keyof typeof SCROLL_AXES]

type AxisReader = {
  offset: (event: NativeScrollEvent) => number
  room: (layout: LayoutRectangle) => number
  size: (content: { width: number; height: number }) => number
}

const AXIS_READERS = {
  [SCROLL_AXES.vertical]: {
    offset: ({ contentOffset }) => contentOffset.y,
    room: ({ height }) => height,
    size: ({ height }) => height,
  },
  [SCROLL_AXES.horizontal]: {
    offset: ({ contentOffset }) => contentOffset.x,
    room: ({ width }) => width,
    size: ({ width }) => width,
  },
} as const satisfies Record<ScrollAxis, AxisReader>

/** How many screens of items stay drawn past the one in view, so the remote always finds the next. */
const SCREENS_AHEAD = 0.25

type Measure = { offset: number; viewport: number; content: number }

/** Whether the screen in view is within `SCREENS_AHEAD` screens of the end of what is drawn. */
export const isNearEnd = ({ offset, viewport, content }: Measure): boolean =>
  viewport > 0 && offset + viewport * (1 + SCREENS_AHEAD) >= content

type UseScrollWindowProps = {
  /** How many items there are to draw. */
  total: number
  /** How many are drawn before anything has scrolled. */
  first: number
  /** How many more a scroll toward the end draws. */
  step: number
  axis: ScrollAxis
}

/**
 * How many of a list's items to draw. Every card is a dozen native views, so drawing a whole
 * Home (a shelf per pinned library, and a Continue watching row of every spot in progress) made
 * every frame replay well over a thousand views, and the remote moved through the side menu at a
 * third of the screen's refresh rate. The window grows as the list scrolls toward its end and
 * never shrinks, so nothing already seen moves.
 */
export const useScrollWindow = ({ total, first, step, axis }: UseScrollWindowProps) => {
  const [count, setCount] = useState(first)
  const measure = useRef<Measure>({ offset: 0, viewport: 0, content: 0 })
  const reader = AXIS_READERS[axis]

  const grow = () => {
    if (count >= total || !isNearEnd(measure.current)) return
    setCount((drawn) => Math.min(total, drawn + step))
  }

  return {
    count,
    onLayout: ({ nativeEvent }: LayoutChangeEvent) => {
      measure.current = { ...measure.current, viewport: reader.room(nativeEvent.layout) }
      grow()
    },
    onContentSizeChange: (width: number, height: number) => {
      measure.current = { ...measure.current, content: reader.size({ width, height }) }
      grow()
    },
    onScroll: ({ nativeEvent }: NativeSyntheticEvent<NativeScrollEvent>) => {
      measure.current = { ...measure.current, offset: reader.offset(nativeEvent) }
      grow()
    },
  }
}
