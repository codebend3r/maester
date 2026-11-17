import { useEffect } from 'react'
import { View } from 'react-native'
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'

import { type WrenTheme, themedStyles } from '@/theme/wrenTheme'
import { SIZE } from '@/theme/wrenTokens'

/*
 * The four bars from the logo's chest: each one's height at rest as a share of the tallest,
 * the height it swings to, and how long one swing takes in milliseconds.
 */
const BARS = [
  { rest: 0.45, peak: 0.9, period: 900 },
  { rest: 1, peak: 0.4, period: 1100 },
  { rest: 0.66, peak: 0.25, period: 800 },
  { rest: 0.3, peak: 0.8, period: 1200 },
] as const

type Bar = (typeof BARS)[number]

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  bars: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: SIZE.equalizerGap,
    height: SIZE.equalizer,
  },
  bar: {
    backgroundColor: colors.accentText,
    borderRadius: SIZE.equalizerRadius,
    width: SIZE.equalizerBar,
  },
}))

type EqualizerBarProps = { bar: Bar; isAnimating: boolean }

function EqualizerBar({ bar, isAnimating }: EqualizerBarProps) {
  const styles = useStyles()
  const level = useSharedValue<number>(bar.rest)
  useEffect(() => {
    if (!isAnimating) {
      // Paused, the bar stops where it is.
      cancelAnimation(level)
      return
    }
    level.set(
      withRepeat(
        withTiming(bar.peak, { duration: bar.period, easing: Easing.inOut(Easing.quad) }),
        -1,
        true,
      ),
    )
  }, [isAnimating, bar, level])
  const height = useAnimatedStyle(() => ({ height: level.get() * SIZE.equalizer }))
  return <Animated.View style={[styles.bar, height]} />
}

type EqualizerIndicatorProps = {
  /** Whether the track plays: the bars move while it does and hold still while it is paused. */
  isPlaying: boolean
}

/**
 * The now-playing mark: the logo's four equalizer bars, moving while the track plays, frozen
 * while it is paused, and still for a listener who asked for less motion. Decorative: the row
 * it sits in says it is playing.
 */
export function EqualizerIndicator({ isPlaying }: EqualizerIndicatorProps) {
  const styles = useStyles()
  const isReduced = useReducedMotion()
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.bars}
    >
      {BARS.map((bar) => (
        <EqualizerBar bar={bar} isAnimating={isPlaying && !isReduced} key={bar.period} />
      ))}
    </View>
  )
}
