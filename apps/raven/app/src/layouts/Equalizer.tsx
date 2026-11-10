import { useEffect, useMemo, useState } from 'react'
import { Animated, Easing, StyleSheet, View } from 'react-native'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'

import { useTheme } from '@/theme/useTheme'

/** How wide each column of the skyline stands, in points, and the fewest columns it draws. */
const COLUMN_POINTS = 8
const FEWEST_COLUMNS = 12

/** How long the skyline takes to come back to the shape it started from, and how many points of that loop each column is drawn through. */
const CYCLE_MS = 6000
const SAMPLES = 48

/** The least and most a column stands, as a share of the room. */
const LOW = 0.08
const HIGH = 1

/** The light crest line across the skyline, as shares of the room from its top. */
const CREST = { from: 0.12, to: 0.15 } as const

/** How opaque the columns are at their top and at their foot, so the cover shows through below. */
const OPACITY = { top: 0.85, foot: 0.35 } as const

const TURN = Math.PI * 2

type ShareAtProps = { at: number; column: number }

/**
 * How tall a column stands at a point of the loop: a few waves running across the columns at
 * whole-number speeds, so neighbours rise together into one silhouette and the loop meets
 * itself seamlessly.
 */
const shareAt = ({ at, column }: ShareAtProps): number => {
  const wave =
    0.5 +
    0.26 * Math.sin(TURN * 4 * at + column * 0.35) +
    0.18 * Math.sin(TURN * 6 * at - column * 0.21) +
    0.08 * Math.sin(TURN * 9 * at + column * 1.3)
  return Math.min(HIGH, Math.max(LOW, wave))
}

const INPUT_RANGE = Array.from({ length: SAMPLES + 1 }, (_, sample) => sample / SAMPLES)

type ColumnDropsOfProps = { column: number; height: number }

/** How far a column's top sits below the room's top at each point of the loop. */
const columnDropsOf = ({ column, height }: ColumnDropsOfProps): number[] =>
  INPUT_RANGE.map((at) => (1 - shareAt({ at, column })) * height)

type EqualizerProps = {
  width: number
  height: number
}

/**
 * The skyline: gapless columns forming one shifting silhouette in the played colour, fading
 * toward the foot they rise from, always moving, as the owner asked. The player hands no
 * spectrum over, so the shape runs on its own loop. Each column is clipped from its top: its
 * window slides down while what is drawn inside slides back up, so the gradient and the crest
 * stay fixed to the room and only the column's height changes, all on the native driver.
 */
export const Equalizer = ({ width, height }: EqualizerProps) => {
  const played = useTheme((theme) => theme.palette.played)
  const accent = useTheme((theme) => theme.palette.accent)
  const crest = useTheme((theme) => theme.palette.text)
  const [clock] = useState(() => new Animated.Value(0))
  const count = Math.max(FEWEST_COLUMNS, Math.round(width / COLUMN_POINTS))

  const columns = useMemo(
    () =>
      Array.from({ length: count }, (_, column) => {
        const drop = clock.interpolate({
          inputRange: INPUT_RANGE,
          outputRange: columnDropsOf({ column, height }),
        })
        return { key: column, drop, lift: Animated.multiply(drop, -1) }
      }),
    [clock, count, height],
  )

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(clock, {
        toValue: 1,
        duration: CYCLE_MS,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    )
    loop.start()
    return () => loop.stop()
  }, [clock])

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[styles.skyline, { width, height }]}
    >
      {columns.map(({ key, drop, lift }) => (
        <Animated.View key={key} style={[styles.column, { transform: [{ translateY: drop }] }]}>
          <Animated.View style={{ height, transform: [{ translateY: lift }] }}>
            <Svg height={height} width="100%">
              <Defs>
                <LinearGradient id={`skyline-${key}`} x1="0" x2="0" y1="0" y2="1">
                  <Stop offset={0} stopColor={played} stopOpacity={OPACITY.top} />
                  <Stop offset={1} stopColor={accent} stopOpacity={OPACITY.foot} />
                </LinearGradient>
              </Defs>
              <Rect fill={`url(#skyline-${key})`} height={height} width="100%" x={0} y={0} />
              <Rect
                fill={crest}
                height={height * (CREST.to - CREST.from)}
                width="100%"
                x={0}
                y={height * CREST.from}
              />
            </Svg>
          </Animated.View>
        </Animated.View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  skyline: { flexDirection: 'row', overflow: 'hidden' },
  column: { flex: 1, overflow: 'hidden' },
})
