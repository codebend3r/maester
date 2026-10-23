import { AccessibilityInfo } from 'react-native'
import { create } from 'zustand'

/** Whether the system asks for less motion: true until it has answered, so nothing moves first. */
export const useReduceMotion = create<{ isReduced: boolean }>()(() => ({ isReduced: true }))

const ACCESSIBILITY_EVENTS = { reduceMotionChanged: 'reduceMotionChanged' } as const

/** Keeps `useReduceMotion` in step with the system setting; returns the way to stop. */
export const followReduceMotion = (): (() => void) => {
  const subscription = AccessibilityInfo.addEventListener(
    ACCESSIBILITY_EVENTS.reduceMotionChanged,
    (isReduced) => useReduceMotion.setState({ isReduced }),
  )
  void AccessibilityInfo.isReduceMotionEnabled().then(
    (isReduced) => useReduceMotion.setState({ isReduced }),
    () => undefined,
  )
  return () => subscription.remove()
}
