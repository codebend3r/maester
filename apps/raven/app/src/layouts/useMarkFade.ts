import { useEffect, useState } from 'react'
import { Animated } from 'react-native'

import { useReduceMotion } from '@/stores/reduceMotion'

type MarkTiming = { holdMs: number; fadeMs: number }

/**
 * How long a flash stands before it fades, and how long the fade takes: a mark's words, and the
 * wash over the half of the picture a double tap landed on, which is gone after a second.
 */
export const MARK_TIMINGS = {
  mark: { holdMs: 500, fadeMs: 300 },
  area: { holdMs: 600, fadeMs: 400 },
} as const satisfies Record<string, MarkTiming>

type UseMarkFadeProps = {
  /** A flash stands a moment and fades; a mark that stays (a pause, a hold) never does. */
  isFading: boolean
  timing: MarkTiming
}

/**
 * How a mark over the picture goes, on every chrome that draws one: a fading mark stands for its
 * timing's `holdMs` and fades over its `fadeMs`, or goes at once after both when the system asks
 * for less motion. `isGone` says there is nothing left to draw.
 */
export const useMarkFade = ({ isFading, timing }: UseMarkFadeProps) => {
  const isReduced = useReduceMotion((state) => state.isReduced)
  const [opacity] = useState(() => new Animated.Value(1))
  const [isGone, setGone] = useState(false)
  useEffect(() => {
    if (!isFading) return undefined
    if (isReduced) {
      const timer = setTimeout(() => setGone(true), timing.holdMs + timing.fadeMs)
      return () => clearTimeout(timer)
    }
    const fade = Animated.timing(opacity, {
      toValue: 0,
      delay: timing.holdMs,
      duration: timing.fadeMs,
      useNativeDriver: true,
    })
    fade.start(({ finished }) => {
      if (finished) setGone(true)
    })
    return () => fade.stop()
  }, [isFading, isReduced, opacity, timing])
  return { opacity, isGone }
}
