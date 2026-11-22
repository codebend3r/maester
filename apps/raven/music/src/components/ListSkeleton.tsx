import type { ComponentType } from 'react'
import { StyleSheet, View } from 'react-native'
import Animated, { Easing, useAnimatedStyle } from 'react-native-reanimated'

import { KIT_COPY } from '@raven/wren'
import { type WrenTheme, themedStyles } from '@/theme/wrenTheme'
import { MOTION, OPACITIES, RADIUS, SIZE, SPACE } from '@/theme/wrenTokens'
import { TileGrid } from '@/ui/TileGrid'
import { useLoop } from '@/ui/useLoop'

/** What a list's entries look like, so the stand-in has their shape: tiles of covers, or rows of songs. */
export const LIST_SHAPES = { tiles: 'tiles', rows: 'rows' } as const

export type ListShape = (typeof LIST_SHAPES)[keyof typeof LIST_SHAPES]

const BONES = 12

const PLACES = Array.from({ length: BONES }, (_, place) => place)

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  bone: { backgroundColor: colors.surface2 },
  tile: { gap: SPACE.s2 },
  cover: { aspectRatio: 1, borderRadius: RADIUS.art, width: '100%' },
  line: { borderRadius: RADIUS.xs, height: SIZE.skeletonLine, width: '80%' },
  shortLine: { borderRadius: RADIUS.xs, height: SIZE.skeletonLine, width: '50%' },
  row: { alignItems: 'center', flexDirection: 'row', gap: SPACE.s4, height: SIZE.row },
  art: { borderRadius: RADIUS.xs, height: SIZE.rowArt, width: SIZE.rowArt },
  text: { flex: 1, gap: SPACE.s2 },
}))

const layout = StyleSheet.create({ fill: { flex: 1 } })

const breathing = Easing.inOut(Easing.quad)

/** The stand-ins' breathing, low and back again; still when the listener asked for less motion. */
const useBreath = () => {
  const breath = useLoop({
    from: 1,
    to: OPACITIES.breathe,
    duration: MOTION.breathe,
    easing: breathing,
    isReversed: true,
  })
  return useAnimatedStyle(() => ({ opacity: breath.get() }))
}

const TileBones = () => {
  const styles = useStyles()
  return (
    <TileGrid
      items={PLACES}
      keyOf={(place) => place}
      renderTile={({ width }) => (
        <View style={[styles.tile, { width }]}>
          <View style={[styles.bone, styles.cover]} />
          <View style={[styles.bone, styles.line]} />
          <View style={[styles.bone, styles.shortLine]} />
        </View>
      )}
    />
  )
}

const RowBones = () => {
  const styles = useStyles()
  return (
    <View>
      {PLACES.map((place) => (
        <View key={place} style={styles.row}>
          <View style={[styles.bone, styles.art]} />
          <View style={styles.text}>
            <View style={[styles.bone, styles.line]} />
            <View style={[styles.bone, styles.shortLine]} />
          </View>
        </View>
      ))}
    </View>
  )
}

const SHAPE_BONES = {
  [LIST_SHAPES.tiles]: TileBones,
  [LIST_SHAPES.rows]: RowBones,
} as const satisfies Record<ListShape, ComponentType>

type ListSkeletonProps = { shape: ListShape }

/** Grey stand-ins in the shape of a list's entries while it is read; the words are for a screen reader alone. */
export function ListSkeleton({ shape }: ListSkeletonProps) {
  const breath = useBreath()
  const Bones = SHAPE_BONES[shape]
  return (
    <View
      accessibilityLabel={KIT_COPY.loading}
      accessibilityLiveRegion="polite"
      accessibilityRole="progressbar"
      accessible
      style={layout.fill}
    >
      <Animated.View importantForAccessibility="no-hide-descendants" style={breath}>
        <Bones />
      </Animated.View>
    </View>
  )
}
