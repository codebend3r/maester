import { type ReactNode, useEffect } from 'react'
import { Modal, Pressable, Text, View, useWindowDimensions } from 'react-native'
import {
  GestureDetector,
  GestureHandlerRootView,
  usePanGesture,
} from 'react-native-gesture-handler'
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { scheduleOnRN } from 'react-native-worklets'

import type { Cover } from '@/music/useCovers'
import { type WrenTheme, themedStyles, useWrenTheme } from '@/theme/wrenTheme'
import { MOTION, RADIUS, SIZE, SPACE, TYPE } from '@/theme/wrenTokens'
import { AlbumArt } from '@/ui/AlbumArt'
import { KIT_COPY } from '@/ui/copy'
import { ICON_BUTTON_VARIANTS, IconButton } from '@/ui/IconButton'
import { ICONS } from '@/ui/WrenIcon'

// A drag past this far down, or a flick this fast, lets the sheet go.
const DISMISS = { distance: 120, velocity: 900 } as const

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  root: { flex: 1, justifyContent: 'flex-end' },
  scrim: {
    backgroundColor: colors.scrim,
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: RADIUS.sheet,
    borderTopRightRadius: RADIUS.sheet,
    paddingHorizontal: SPACE.s2,
  },
  grabberZone: { alignItems: 'center', paddingVertical: SPACE.s2 },
  grabber: {
    backgroundColor: colors.line2,
    borderRadius: RADIUS.pill,
    height: SIZE.grabberHeight,
    width: SIZE.grabberWidth,
  },
  header: {
    alignItems: 'center',
    borderBottomColor: colors.line,
    borderBottomWidth: SIZE.hairline,
    flexDirection: 'row',
    gap: SPACE.s3,
    paddingBottom: SPACE.s3,
    paddingHorizontal: SPACE.s3,
  },
  headerText: { flex: 1 },
  title: { ...TYPE.rowStrong, color: colors.text },
  subtitle: { ...TYPE.meta, color: colors.text2 },
}))

/** What a sheet is about, at its top: a track's cover, its title and its line. */
type SheetHead = { title: string; subtitle?: string; cover?: Cover | null }

type BottomSheetProps = {
  /** Whether the sheet is up. */
  isOpen: boolean
  /** Asked once the sheet has gone, after a drag, a tap on the scrim, or Close. */
  onClose: () => void
  head: SheetHead
  children: ReactNode
}

type SheetBodyProps = Omit<BottomSheetProps, 'isOpen'>

function SheetBody({ onClose, head, children }: SheetBodyProps) {
  const styles = useStyles()
  const { colors } = useWrenTheme()
  const { height } = useWindowDimensions()
  const { bottom } = useSafeAreaInsets()
  const isReduced = useReducedMotion()
  const offset = useSharedValue(height)
  const duration = isReduced ? 0 : MOTION.sheet

  useEffect(() => {
    offset.set(withSpring(0, { duration, dampingRatio: 1 }))
  }, [offset, duration])

  // Slides the sheet off the bottom, then tells the screen it has gone.
  const slideAway = () => {
    'worklet'
    offset.set(
      withTiming(height, { duration }, (isDone) => {
        if (isDone) scheduleOnRN(onClose)
      }),
    )
  }

  const drag = usePanGesture({
    activeOffsetY: SPACE.s2,
    onUpdate: ({ translationY }) => {
      'worklet'
      offset.set(Math.max(0, translationY))
    },
    onDeactivate: ({ translationY, velocityY }) => {
      'worklet'
      if (translationY > DISMISS.distance || velocityY > DISMISS.velocity) {
        slideAway()
        return
      }
      offset.set(withSpring(0, { duration, dampingRatio: 1 }))
    },
  })

  const slide = useAnimatedStyle(() => ({ transform: [{ translateY: offset.get() }] }))
  const fade = useAnimatedStyle(() => ({ opacity: 1 - Math.min(1, offset.get() / height) }))

  return (
    <GestureHandlerRootView style={styles.root}>
      <Animated.View style={[styles.scrim, fade]}>
        <Pressable
          accessibilityLabel={KIT_COPY.close}
          accessibilityRole="button"
          onPress={slideAway}
          style={styles.root}
        />
      </Animated.View>
      <GestureDetector gesture={drag}>
        <Animated.View
          accessibilityViewIsModal
          style={[styles.sheet, { paddingBottom: bottom + SPACE.s2 }, slide]}
        >
          <View style={styles.grabberZone}>
            <View style={styles.grabber} />
          </View>
          <View style={styles.header}>
            {head.cover !== undefined && (
              <AlbumArt cover={head.cover} radius={RADIUS.thumb} size={SIZE.sheetArt} />
            )}
            <View style={styles.headerText}>
              <Text accessibilityRole="header" numberOfLines={1} style={styles.title}>
                {head.title}
              </Text>
              {head.subtitle !== undefined && (
                <Text numberOfLines={1} style={styles.subtitle}>
                  {head.subtitle}
                </Text>
              )}
            </View>
            <IconButton
              color={colors.text2}
              icon={ICONS.close}
              label={KIT_COPY.close}
              onPress={slideAway}
              size={SIZE.smallButton}
              variant={ICON_BUTTON_VARIANTS.filled}
            />
          </View>
          {children}
        </Animated.View>
      </GestureDetector>
    </GestureHandlerRootView>
  )
}

/**
 * A sheet rising from the bottom over a scrim: a grabber, a head naming what it is about, and
 * its actions. It goes with a drag down, a tap on the scrim or Close; it has no Cancel. It
 * springs up in about a third of a second, or at once for a listener who asked for less motion.
 */
export function BottomSheet({ isOpen, onClose, head, children }: BottomSheetProps) {
  return (
    <Modal onRequestClose={onClose} statusBarTranslucent transparent visible={isOpen}>
      {isOpen && (
        <SheetBody head={head} onClose={onClose}>
          {children}
        </SheetBody>
      )}
    </Modal>
  )
}
