import { Animated, Easing } from 'react-native'

import { MENU_SLIDE_MS } from '@/layouts/touchMenuKit'

/** How dark the page behind an open menu or sheet goes. */
export const SCRIM_OPACITY = 0.5

/** How far a drag must go before it is a swipe and not a tap that wandered. */
export const SWIPE_START = 12

type SlideProps = {
  progress: Animated.Value
  to: number
  isReduced: boolean
  onShut: () => void
}

/**
 * Slides a menu or sheet to `to`, 0 shut or 1 out, at once when the system asks for less
 * motion; `onShut` runs once it is all the way in.
 */
export const slide = ({ progress, to, isReduced, onShut }: SlideProps) => {
  if (isReduced) {
    progress.setValue(to)
    if (to === 0) onShut()
    return
  }
  Animated.timing(progress, {
    toValue: to,
    duration: MENU_SLIDE_MS,
    easing: Easing.out(Easing.cubic),
    useNativeDriver: true,
  }).start(({ finished }) => {
    if (finished && to === 0) onShut()
  })
}
