import { usePlayerPrefs } from '@raven/ui/headless'
import { useEffect, useState } from 'react'
import { Animated } from 'react-native'

import { useReduceMotion } from '@/stores/reduceMotion'

/** How long the controls take to fade, where motion is allowed. */
const FADE_MS = 200

type UseFadeProps = { isVisible: boolean; isReduced: boolean }

/**
 * The controls' opacity, and whether they are drawn: they fade in as they appear and are drawn
 * until they have faded out, or appear and go at once when the system asks for less motion.
 */
const useFade = ({ isVisible, isReduced }: UseFadeProps) => {
  const [opacity] = useState(() => new Animated.Value(isVisible ? 1 : 0))
  // Where the last fade came to rest: the controls stay drawn while one runs out from it.
  const [hasRestedVisible, setRestedVisible] = useState(isVisible)
  useEffect(() => {
    const toValue = isVisible ? 1 : 0
    if (isReduced) {
      opacity.setValue(toValue)
      return undefined
    }
    const fade = Animated.timing(opacity, { toValue, duration: FADE_MS, useNativeDriver: true })
    fade.start(({ finished }) => {
      if (finished) setRestedVisible(isVisible)
    })
    return () => fade.stop()
  }, [isVisible, isReduced, opacity])
  return { opacity, isDrawn: isVisible || (!isReduced && hasRestedVisible) }
}

type UseControlsLingerProps = {
  /** Whether the video plays: only then do the controls go; paused, opening or ended they stay up. */
  isPlaying: boolean
  /** Whether something holds them up while it plays, as a picker's open list does. */
  isHeld?: boolean
}

/**
 * What raven's player controls share on every platform that draws its own: they fade once the
 * video has played untouched for the viewer's linger (the player preferences'
 * `controlsLingerSeconds`), and come back on `show`, or on `toggle`, which also hides them. `stir`
 * starts the linger again without changing them, for a touch on a control. They fade over
 * `FADE_MS`, or go at once when the system asks for less motion, and `isDrawn` says whether
 * there is still something to draw while a fade runs out.
 */
export const useControlsLinger = ({ isPlaying, isHeld = false }: UseControlsLingerProps) => {
  const lingerSeconds = usePlayerPrefs((prefs) => prefs.controlsLingerSeconds)
  const isReduced = useReduceMotion((state) => state.isReduced)
  const [isShown, setShown] = useState(true)
  const [stirredAt, setStirredAt] = useState(() => Date.now())
  const isVisible = isShown || !isPlaying
  const { opacity, isDrawn } = useFade({ isVisible, isReduced })

  useEffect(() => {
    if (!isShown || !isPlaying || isHeld) return undefined
    const left = Math.max(0, stirredAt + lingerSeconds * 1000 - Date.now())
    const timer = setTimeout(() => setShown(false), left)
    return () => clearTimeout(timer)
  }, [isShown, isPlaying, isHeld, lingerSeconds, stirredAt])

  const stir = () => setStirredAt(Date.now())
  const show = () => {
    stir()
    setShown(true)
  }
  const toggle = () => {
    stir()
    setShown(!isVisible)
  }

  return { isVisible, isDrawn, opacity, stir, show, toggle }
}
