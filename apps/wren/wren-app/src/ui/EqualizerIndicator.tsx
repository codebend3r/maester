import { useEffect } from 'react'
import { View } from 'react-native'
import Animated, {
  Easing,
  useAnimatedStyle,
  useFrameCallback,
  useReducedMotion,
  useSharedValue,
} from 'react-native-reanimated'

import { type WrenTheme, themedStyles } from '@/theme/wrenTheme'
import { ON_PICTURE } from '@raven/wren'
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

// A bar's phase runs from 0 to 2 and wraps: up to the peak over the first swing, back to rest over the second.
const LOOP = 2

const swing = Easing.inOut(Easing.quad)

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
  // On a cover's veil the bars wear the picture's ink, the same in every theme.
  pictureBar: { backgroundColor: ON_PICTURE.ink },
}))

type EqualizerBarProps = { bar: Bar; isAnimating: boolean; isOnPicture: boolean }

function EqualizerBar({ bar, isAnimating, isOnPicture }: EqualizerBarProps) {
  const styles = useStyles()
  const phase = useSharedValue(0)
  // Paused, the phase holds, so the bar stops where it is and swings on from there when play resumes.
  const frames = useFrameCallback(({ timeSincePreviousFrame }) => {
    phase.set((phase.get() + (timeSincePreviousFrame ?? 0) / bar.period) % LOOP)
  }, false)
  useEffect(() => {
    frames.setActive(isAnimating)
  }, [frames, isAnimating])
  const height = useAnimatedStyle(() => {
    const at = phase.get()
    const share = swing(at <= 1 ? at : LOOP - at)
    return { height: (bar.rest + (bar.peak - bar.rest) * share) * SIZE.equalizer }
  })
  return <Animated.View style={[styles.bar, isOnPicture && styles.pictureBar, height]} />
}

type EqualizerIndicatorProps = {
  /** Whether the track plays: the bars move while it does and hold still while it is paused. */
  isPlaying: boolean
  /** Whether it sits on a cover's veil, so its bars wear the picture's ink rather than the accent. */
  isOnPicture?: boolean
}

/**
 * The now-playing mark: the logo's four equalizer bars, moving while the track plays, frozen
 * while it is paused, and still for a listener who asked for less motion. Decorative: the row
 * it sits in says it is playing.
 */
export function EqualizerIndicator({ isPlaying, isOnPicture = false }: EqualizerIndicatorProps) {
  const styles = useStyles()
  const isReduced = useReducedMotion()
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.bars}
    >
      {BARS.map((bar) => (
        <EqualizerBar
          bar={bar}
          isAnimating={isPlaying && !isReduced}
          isOnPicture={isOnPicture}
          key={bar.period}
        />
      ))}
    </View>
  )
}
