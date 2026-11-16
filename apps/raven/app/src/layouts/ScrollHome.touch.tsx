import { Icon } from '@raven/native'
import { type ComponentProps, type ComponentRef, useEffect, useRef, useState } from 'react'
import {
  Animated,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { isScrolledAway } from '@/layouts/scrollHome'
import { slide } from '@/layouts/slide'
import { TOUCH_NAV_COPY } from '@/layouts/touchMenuKit'
import { deviceNavKind } from '@/platform/devicePlatform'
import { NAV_KINDS } from '@/platform/platform'
import { useReduceMotion } from '@/stores/reduceMotion'
import { OPACITIES, SIZES } from '@/theme/appTheme'
import { APP_ICONS } from '@/theme/icons'
import { translucent } from '@/theme/translucent'
import { themedStyles, useTheme } from '@/theme/useTheme'

/** How opaque the button's plate is: enough to find, little enough to see the page through. */
const PLATE_ALPHA = 0.6

/** How far below its place the button starts as it comes in, in points. */
const RISE = SIZES.space8

/** How often a scrolling page says where it is, in milliseconds: once a frame. */
export const SCROLL_EVERY_MS = 16

/** The button, once it has gone, has nothing left to do. */
const onGone = () => {}

type ScrollHome = {
  /** Whether the page has left its top behind. */
  isAway: boolean
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void
}

/** Follows a page's scroll, to know when its top, and the header's buttons, are out of reach. */
export const useScrollHome = (): ScrollHome => {
  const [isAway, setAway] = useState(false)
  return {
    isAway,
    onScroll: ({ nativeEvent }) => setAway(isScrolledAway(nativeEvent.contentOffset.y)),
  }
}

type ScrollHomeButtonProps = {
  isAway: boolean
  /** Takes the page back to its top. */
  onPress: () => void
}

/**
 * The way back to a page's top on an iPad, where the header's menu button opens the side menu:
 * a round, see-through Home plate at the middle of the screen's foot, which rises in once the
 * page is scrolled away from its top, stays put while it scrolls, and sinks away at the top.
 * It comes and goes at once when the system asks for less motion, and an iPhone draws none.
 */
export const ScrollHomeButton = ({ isAway, onPress }: ScrollHomeButtonProps) => {
  const styles = useStyles()
  const insets = useSafeAreaInsets()
  const text = useTheme((theme) => theme.palette.text)
  const isReduced = useReduceMotion((motion) => motion.isReduced)
  const [progress] = useState(() => new Animated.Value(0))
  useEffect(() => {
    slide({ progress, to: isAway ? 1 : 0, isReduced, onShut: onGone })
  }, [progress, isAway, isReduced])
  const rise = progress.interpolate({ inputRange: [0, 1], outputRange: [RISE, 0] })
  // An iPad's pages have the button; an iPhone's tab bar already holds the foot of the screen.
  return (
    deviceNavKind() === NAV_KINDS.drawer && (
      <Animated.View
        accessibilityElementsHidden={!isAway}
        pointerEvents={isAway ? 'box-none' : 'none'}
        style={[
          styles.slot,
          { bottom: insets.bottom + SIZES.space4, opacity: progress },
          { transform: [{ translateY: rise }] },
        ]}
      >
        <Pressable
          accessibilityLabel={TOUCH_NAV_COPY.top}
          accessibilityRole="button"
          hitSlop={SIZES.space2}
          onPress={onPress}
          style={({ pressed }) => [styles.plate, pressed && styles.pressed]}
        >
          <Icon colour={text} name={APP_ICONS.home} size={SIZES.textXl} />
        </Pressable>
      </Animated.View>
    )
  )
}

type HomeScrollViewProps = ComponentProps<typeof ScrollView>

/**
 * A touch page that scrolls as one: a `ScrollView` filling its room, with the way back to its
 * top (`ScrollHomeButton`) over its foot.
 */
export const HomeScrollView = ({ children, ...props }: HomeScrollViewProps) => {
  const scroller = useRef<ComponentRef<typeof ScrollView>>(null)
  const isReduced = useReduceMotion((motion) => motion.isReduced)
  const { isAway, onScroll } = useScrollHome()
  return (
    <View style={roomStyles.room}>
      <ScrollView
        {...props}
        ref={scroller}
        onScroll={onScroll}
        scrollEventThrottle={SCROLL_EVERY_MS}
      >
        {children}
      </ScrollView>
      <ScrollHomeButton
        isAway={isAway}
        onPress={() => scroller.current?.scrollTo({ y: 0, animated: !isReduced })}
      />
    </View>
  )
}

const roomStyles = StyleSheet.create({ room: { flex: 1 } })

const useStyles = themedStyles((colours) =>
  StyleSheet.create({
    slot: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
    plate: {
      width: SIZES.fieldHeight + SIZES.space2,
      height: SIZES.fieldHeight + SIZES.space2,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: SIZES.fieldHeight,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colours.line,
      backgroundColor: translucent({ colour: colours.raised, alpha: PLATE_ALPHA }),
    },
    pressed: { opacity: OPACITIES.pressed },
  }),
)
