import { type ReactNode, useEffect, useState } from 'react'
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from 'react-native'

/** The intro's beats, in milliseconds, and how far the logo travels as it comes in and goes. */
const LAUNCH_INTRO = {
  /** The mark grows into place and fades in, overshooting a little as it settles. */
  enterMs: 620,
  /** What follows the mark (Wren's wordmark) starts this long after it, sliding in from the left. */
  followDelayMs: 260,
  followMs: 460,
  /** The shortest time the logo stays up, so a fast load still shows the whole of it. */
  shownMs: 1500,
  /** Once the app is ready, the logo fades and lifts away to show it. */
  leaveMs: 380,
  fromScale: 0.7,
  leaveScale: 1.08,
  followShift: -32,
  /** How far the mark overshoots its size as it lands: Easing.back's tension. */
  overshoot: 1.5,
} as const

/** How a test finds the intro. */
export const LAUNCH_INTRO_TEST_ID = 'launch-intro'

type LaunchIntroProps = {
  /** The splash's own colour, so the native splash hands over to the intro without a flash. */
  ground: string
  mark: ReactNode
  /** Drawn over the mark's box once the mark is in: Wren's wordmark beside its bird. */
  follow?: ReactNode
  /** Whether the app under it has loaded and can be shown. */
  isReady: boolean
  /** The intro has drawn its first frame: the native splash can go. */
  onShown: () => void
}

/** What an app's launch takes from its root: whether the app is ready, and how to hide the splash. */
export type LaunchProps = Pick<LaunchIntroProps, 'isReady' | 'onShown'>

type TimingProps = Omit<Animated.TimingAnimationConfig, 'useNativeDriver'> & {
  value: Animated.Value
}

const timing = ({ value, ...config }: TimingProps) =>
  Animated.timing(value, { ...config, useNativeDriver: true })

/**
 * The logo as a TV app opens, over the app while it loads: the mark grows in, then what follows
 * it, and once the app is ready and the logo has been up long enough it fades away to show it.
 * With less motion asked for, the logo is simply there, and fades. Once faded it takes itself off.
 */
export const LaunchIntro = ({ ground, mark, follow, isReady, onShown }: LaunchIntroProps) => {
  const [markIn] = useState(() => new Animated.Value(0))
  const [followIn] = useState(() => new Animated.Value(0))
  const [leave] = useState(() => new Animated.Value(0))
  const [hasBeenShown, setHasBeenShown] = useState(false)
  const [isGone, setIsGone] = useState(false)

  useEffect(() => {
    let isCurrent = true
    const comeIn = (isReduced: boolean) => {
      if (!isCurrent) return
      if (isReduced) {
        markIn.setValue(1)
        followIn.setValue(1)
        return
      }
      Animated.parallel([
        timing({
          value: markIn,
          toValue: 1,
          duration: LAUNCH_INTRO.enterMs,
          easing: Easing.out(Easing.back(LAUNCH_INTRO.overshoot)),
        }),
        timing({
          value: followIn,
          toValue: 1,
          delay: LAUNCH_INTRO.followDelayMs,
          duration: LAUNCH_INTRO.followMs,
          easing: Easing.out(Easing.cubic),
        }),
      ]).start()
    }
    // A system that cannot say moves the logo, as most TVs ask for nothing less.
    AccessibilityInfo.isReduceMotionEnabled().then(comeIn, () => comeIn(false))
    const shown = setTimeout(() => setHasBeenShown(true), LAUNCH_INTRO.shownMs)
    return () => {
      isCurrent = false
      clearTimeout(shown)
    }
  }, [markIn, followIn])

  useEffect(() => {
    if (!isReady || !hasBeenShown) return
    timing({
      value: leave,
      toValue: 1,
      duration: LAUNCH_INTRO.leaveMs,
      easing: Easing.in(Easing.cubic),
    }).start(() => setIsGone(true))
  }, [isReady, hasBeenShown, leave])

  const stage = {
    opacity: leave.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
    transform: [
      {
        scale: leave.interpolate({ inputRange: [0, 1], outputRange: [1, LAUNCH_INTRO.leaveScale] }),
      },
    ],
  }
  const markStyle = {
    opacity: markIn.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' }),
    transform: [
      {
        scale: markIn.interpolate({ inputRange: [0, 1], outputRange: [LAUNCH_INTRO.fromScale, 1] }),
      },
    ],
  } as const
  const followStyle = {
    opacity: followIn,
    transform: [
      {
        translateX: followIn.interpolate({
          inputRange: [0, 1],
          outputRange: [LAUNCH_INTRO.followShift, 0],
        }),
      },
    ],
  }

  return (
    !isGone && (
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        onLayout={onShown}
        style={[styles.ground, { backgroundColor: ground }]}
        testID={LAUNCH_INTRO_TEST_ID}
      >
        <Animated.View style={stage}>
          <Animated.View style={markStyle}>{mark}</Animated.View>
          {follow !== undefined && (
            <Animated.View style={[StyleSheet.absoluteFill, followStyle]}>{follow}</Animated.View>
          )}
        </Animated.View>
      </View>
    )
  )
}

const styles = StyleSheet.create({
  // It covers the app only to be seen: a touch or the remote's focus reaches the app under it.
  ground: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none',
  },
})
