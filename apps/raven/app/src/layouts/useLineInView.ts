import { useEffect, useRef, useState } from 'react'
import type { LayoutChangeEvent, LayoutRectangle, ScrollViewInstance } from 'react-native'

import { lineScrollOf } from '@/layouts/lineInView'
import { useReduceMotion } from '@/stores/reduceMotion'

type UseLineInViewProps = {
  /** The place of the line to keep in view, or null for none. */
  current: number | null
}

/**
 * Keeps the line at `current` in the middle of the box its lines scroll in, as each line becomes
 * the one sung: smoothly, or at once when the system asks for less motion. Each line and the
 * box report where they are laid out.
 */
export const useLineInView = ({ current }: UseLineInViewProps) => {
  const scroll = useRef<ScrollViewInstance>(null)
  const lines = useRef<Readonly<Record<number, LayoutRectangle>>>({})
  const [box, setBox] = useState(0)
  const isReduced = useReduceMotion((state) => state.isReduced)
  useEffect(() => {
    if (current === null) return
    const line = lines.current[current]
    if (line === undefined) return
    scroll.current?.scrollTo({
      y: lineScrollOf({ y: line.y, height: line.height, box }),
      animated: !isReduced,
    })
  }, [current, box, isReduced])
  return {
    scroll,
    onBoxLayout: (event: LayoutChangeEvent) => setBox(event.nativeEvent.layout.height),
    lineLayoutOf: (place: number) => (event: LayoutChangeEvent) => {
      lines.current = { ...lines.current, [place]: event.nativeEvent.layout }
    },
  }
}
