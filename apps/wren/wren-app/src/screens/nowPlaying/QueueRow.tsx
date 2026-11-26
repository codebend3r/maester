import { NOW_PLAYING_COPY, type UpNextRow } from '@raven/wren'
import { Pressable, Text, View } from 'react-native'
import { GestureDetector, useCompetingGestures, usePanGesture } from 'react-native-gesture-handler'
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'

import { type Covers } from '@raven/wren-native'
import { dropPlaceOf } from '@/screens/nowPlaying/dropPlace'
import type { UpNextPlace } from '@/screens/nowPlaying/UpNext'
import { type WrenTheme, themedStyles, useWrenTheme } from '@/theme/wrenTheme'
import { MOTION, PLAYER_SIZES, RADIUS, SIZE, SPACE, TYPE } from '@/theme/wrenTokens'
import { AlbumArt } from '@/ui/AlbumArt'
import { pressedStyleOf } from '@/ui/press'
import { ICONS, WrenIcon } from '@/ui/WrenIcon'

/*
 * How long a finger rests on a row before it lifts to be dragged, in milliseconds, and how far
 * a row swiped left must go before it is let go of.
 */
const DRAG = { holdMs: 300, removeDistance: 96 } as const

/** What a screen reader offers on a row, since a drag is not a screen reader's gesture. */
export const ROW_ACTIONS = { moveUp: 'moveUp', moveDown: 'moveDown', remove: 'remove' } as const

type RowAction = (typeof ROW_ACTIONS)[keyof typeof ROW_ACTIONS]

const isRowAction = (name: string): name is RowAction =>
  Object.values<string>(ROW_ACTIONS).includes(name)

/** A row's move, from its place to another. */
type RowMove = { from: number; to: number }

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  holder: { borderBottomColor: colors.line, borderBottomWidth: SIZE.hairline },
  underlay: {
    alignItems: 'center',
    backgroundColor: colors.accentSoft,
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    paddingHorizontal: SIZE.gutter,
    position: 'absolute',
    right: 0,
    top: 0,
    flexDirection: 'row-reverse',
  },
  row: {
    alignItems: 'center',
    backgroundColor: colors.bg,
    flexDirection: 'row',
    gap: SIZE.rowGap,
  },
  // Under the phone's player: inside the player's gutters.
  sheet: { paddingLeft: PLAYER_SIZES.gutter, paddingRight: SIZE.gutter },
  panel: { backgroundColor: colors.surface },
  main: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: SIZE.rowGap, height: '100%' },
  text: { flex: 1 },
  title: { ...TYPE.rowTitle, color: colors.text },
  line: { ...TYPE.meta, color: colors.text2 },
}))

type QueueRowProps = {
  row: UpNextRow
  trackCoverOf: Covers['trackCoverOf']
  /** The first and last places a row may move to: the songs after the one playing. */
  first: number
  last: number
  height: number
  /** Where Up next sits; the tablet's panel has its own ground and margins. */
  place: UpNextPlace
  onJump: (place: number) => void
  onMove: (move: RowMove) => void
  onRemove: (place: number) => void
}

/**
 * A song in Up next: a press plays it, a long press lifts it to be dragged to another place,
 * and a swipe left lets it go. A screen reader moves it up or down, or removes it, through the
 * row's actions instead.
 */
export function QueueRow({
  row,
  trackCoverOf,
  first,
  last,
  height,
  place: upNextPlace,
  onJump,
  onMove,
  onRemove,
}: QueueRowProps) {
  const styles = useStyles()
  const { colors } = useWrenTheme()
  const isReduced = useReducedMotion()
  const duration = isReduced ? 0 : MOTION.sheet
  const shift = useSharedValue(0)
  const slide = useSharedValue(0)
  const isLifted = useSharedValue(false)
  const { place, track } = row

  const drag = usePanGesture({
    activateAfterLongPress: DRAG.holdMs,
    runOnJS: true,
    onActivate: () => {
      isLifted.set(true)
    },
    onUpdate: ({ translationY }) => {
      shift.set(translationY)
    },
    onDeactivate: ({ translationY }) => {
      isLifted.set(false)
      shift.set(0)
      const to = dropPlaceOf({ place, shift: translationY, rowHeight: height, first, last })
      if (to !== place) onMove({ from: place, to })
    },
  })

  const swipe = usePanGesture({
    activeOffsetX: [-SPACE.s3, SPACE.s3],
    failOffsetY: [-SPACE.s2, SPACE.s2],
    runOnJS: true,
    onUpdate: ({ translationX }) => {
      slide.set(Math.min(0, translationX))
    },
    onDeactivate: ({ translationX }) => {
      if (translationX > -DRAG.removeDistance) {
        slide.set(withTiming(0, { duration }))
        return
      }
      slide.set(0)
      onRemove(place)
    },
  })

  const gestures = useCompetingGestures(drag, swipe)

  const moved = useAnimatedStyle(() => ({
    transform: [{ translateY: shift.get() }, { translateX: slide.get() }],
    zIndex: isLifted.get() ? 1 : 0,
  }))

  const actions = [
    ...(place > first ? [{ name: ROW_ACTIONS.moveUp, label: NOW_PLAYING_COPY.moveUp }] : []),
    ...(place < last ? [{ name: ROW_ACTIONS.moveDown, label: NOW_PLAYING_COPY.moveDown }] : []),
    { name: ROW_ACTIONS.remove, label: NOW_PLAYING_COPY.remove },
  ]

  const actionsByName = {
    [ROW_ACTIONS.moveUp]: () => onMove({ from: place, to: place - 1 }),
    [ROW_ACTIONS.moveDown]: () => onMove({ from: place, to: place + 1 }),
    [ROW_ACTIONS.remove]: () => onRemove(place),
  } as const satisfies Record<RowAction, () => void>

  return (
    <View style={[styles.holder, { height }]}>
      <View style={styles.underlay}>
        <WrenIcon color={colors.accentText} name={ICONS.trash} />
      </View>
      <GestureDetector gesture={gestures}>
        <Animated.View style={[styles.row, styles[upNextPlace], { height }, moved]}>
          <Pressable
            accessibilityActions={actions}
            accessibilityLabel={row.label}
            accessibilityRole="button"
            onAccessibilityAction={({ nativeEvent }) => {
              if (isRowAction(nativeEvent.actionName)) actionsByName[nativeEvent.actionName]()
            }}
            onPress={() => onJump(place)}
            style={pressedStyleOf({ style: styles.main })}
          >
            <AlbumArt cover={trackCoverOf(track)} radius={RADIUS.xs} size={SIZE.miniArt} />
            <View style={styles.text}>
              <Text numberOfLines={1} style={styles.title}>
                {track.title}
              </Text>
              <Text numberOfLines={1} style={styles.line}>
                {row.line}
              </Text>
            </View>
          </Pressable>
          <WrenIcon color={colors.text3} name={ICONS.dragHandle} />
        </Animated.View>
      </GestureDetector>
    </View>
  )
}
