import { useEffect } from 'react'
import {
  type EasingFunction,
  cancelAnimation,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'

type UseLoopProps = {
  from: number
  to: number
  duration: number
  easing: EasingFunction
  /** Whether each pass runs back from `to` to `from`, rather than starting over from `from`. */
  isReversed: boolean
}

/**
 * A value running from `from` to `to` over and over for as long as it is drawn; it holds at
 * `from` for a listener who asked for less motion.
 */
export const useLoop = ({ from, to, duration, easing, isReversed }: UseLoopProps) => {
  const isReduced = useReducedMotion()
  const value = useSharedValue(from)
  useEffect(() => {
    if (isReduced) return
    value.set(withRepeat(withTiming(to, { duration, easing }), -1, isReversed))
    return () => cancelAnimation(value)
  }, [duration, easing, isReduced, isReversed, to, value])
  return value
}
