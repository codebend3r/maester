import { useEffect, useState } from 'react'
import { Animated, Easing, StyleSheet, View } from 'react-native'

import { useReduceMotion } from '@/stores/reduceMotion'
import { TV_SIZES } from '@/theme/tvSizes'
import { useTheme } from '@/theme/useTheme'

const BAR_COUNT = 16

/** How often the bars move while the music plays, and how long each move takes. */
const STEP_MS = 180

/** How high a bar stands at rest, as a share of the room, and the least and most while playing. */
const REST = 0.12
const LOW = 0.15
const HIGH = 1

/**
 * A still pattern for a viewer who asks for less motion, and the shape the bars settle into:
 * low at the edges, tallest a little right of the middle, as a spectrum tends to look.
 */
const STILL_PATTERN = [
  0.3, 0.55, 0.42, 0.7, 0.5, 0.85, 0.6, 0.95, 0.75, 1, 0.65, 0.8, 0.5, 0.62, 0.4, 0.3,
] as const

/** A bar's next height while playing. */
const nextHeightOf = (): number => LOW + Math.random() * (HIGH - LOW)

type EqualizerProps = {
  width: number
  height: number
  /** Whether the bars move; paused, they settle low. */
  isPlaying: boolean
}

/**
 * Bars that dance to the music while it plays and settle while it is paused, in the played
 * colour. The player hands no spectrum over, so the bars move on their own time; with less
 * motion asked for they stand still in one shape. Each bar scales from its foot, so it grows
 * upward as a meter does.
 */
export const Equalizer = ({ width, height, isPlaying }: EqualizerProps) => {
  const isReduced = useReduceMotion((state) => state.isReduced)
  const played = useTheme((theme) => theme.palette.played)
  const [values] = useState(() => STILL_PATTERN.map((share) => new Animated.Value(share)))
  const gap = Math.max(2, Math.round(width * 0.02))
  const bar = Math.max(2, Math.floor((width - gap * (BAR_COUNT + 1)) / BAR_COUNT))

  useEffect(() => {
    if (isReduced) {
      values.forEach((value, index) => value.setValue(STILL_PATTERN[index] ?? REST))
      return undefined
    }
    if (!isPlaying) {
      Animated.parallel(
        values.map((value) =>
          Animated.timing(value, { toValue: REST, duration: STEP_MS, useNativeDriver: true }),
        ),
      ).start()
      return undefined
    }
    let isDancing = true
    const step = () => {
      Animated.parallel(
        values.map((value) =>
          Animated.timing(value, {
            toValue: nextHeightOf(),
            duration: STEP_MS,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
        ),
      ).start(({ finished }) => {
        if (finished && isDancing) step()
      })
    }
    step()
    return () => {
      isDancing = false
    }
  }, [isPlaying, isReduced, values])

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[styles.bars, { width, height, gap }]}
    >
      {values.map((value, index) => (
        <Animated.View
          // The bars never reorder; their place is their identity.
          // oxlint-disable-next-line react/no-array-index-key
          key={index}
          style={{
            width: bar,
            height,
            borderRadius: TV_SIZES.radiusSm,
            backgroundColor: played,
            transform: [
              {
                translateY: value.interpolate({ inputRange: [0, 1], outputRange: [height / 2, 0] }),
              },
              { scaleY: value },
            ],
          }}
        />
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  bars: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center' },
})
