import { useEffect, useState } from 'react'
import { Animated } from 'react-native'

import { useReduceMotion } from '@/stores/reduceMotion'

/** How long a mark over the picture stands before it fades, and how long the fade takes. */
const MARK_HOLD_MS = 500
const MARK_FADE_MS = 300

type UseMarkFadeProps = {
  /** A flash stands a moment and fades; a mark that stays (a pause, a hold) never does. */
  isFading: boolean
}

/**
 * How a mark over the picture goes, on every chrome that draws one: a fading mark stands for
 * `MARK_HOLD_MS` and fades over `MARK_FADE_MS`, or goes at once after both when the system asks
 * for less motion. `isGone` says there is nothing left to draw.
 */
export const useMarkFade = ({ isFading }: UseMarkFadeProps) => {
  const isReduced = useReduceMotion((state) => state.isReduced)
  const [opacity] = useState(() => new Animated.Value(1))
  const [isGone, setGone] = useState(false)
  useEffect(() => {
    if (!isFading) return undefined
    if (isReduced) {
      const timer = setTimeout(() => setGone(true), MARK_HOLD_MS + MARK_FADE_MS)
      return () => clearTimeout(timer)
    }
    const fade = Animated.timing(opacity, {
      toValue: 0,
      delay: MARK_HOLD_MS,
      duration: MARK_FADE_MS,
      useNativeDriver: true,
    })
    fade.start(({ finished }) => {
      if (finished) setGone(true)
    })
    return () => fade.stop()
  }, [isFading, isReduced, opacity])
  return { opacity, isGone }
}
