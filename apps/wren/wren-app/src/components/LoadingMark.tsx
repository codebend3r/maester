import { View } from 'react-native'
import Animated, { Easing, useAnimatedStyle } from 'react-native-reanimated'

import { KIT_COPY } from '@raven/wren'
import { WrenMark } from '@/components/WrenLockup'
import { type WrenTheme, themedStyles } from '@/theme/wrenTheme'
import { MOTION, RADIUS, SIZE } from '@/theme/wrenTokens'
import { useLoop } from '@/ui/useLoop'

type LoadingMarkProps = {
  /** What is loading, said aloud; "Loading" when left out. */
  label?: string
}

// The ring stands twice the mark's size around it, as the web's does.
const RING = SIZE.loadingMark * 2

const TURN_DEGREES = 360

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  ground: {
    alignItems: 'center',
    height: SIZE.touchTarget,
    justifyContent: 'center',
    width: SIZE.touchTarget,
  },
  ring: {
    borderColor: colors.text2,
    borderRadius: RADIUS.pill,
    borderTopColor: 'transparent',
    borderWidth: SIZE.focusRing,
    height: RING,
    position: 'absolute',
    width: RING,
  },
}))

/**
 * Wren's mark with a thin ring turning around it, for anything on its way; the ring holds still
 * for a listener who asked for less motion. The words are for a screen reader alone: Wren never
 * shows loading as plain text.
 */
export function LoadingMark({ label = KIT_COPY.loading }: LoadingMarkProps) {
  const styles = useStyles()
  const turn = useLoop({
    from: 0,
    to: TURN_DEGREES,
    duration: MOTION.spin,
    easing: Easing.linear,
    isReversed: false,
  })
  const spin = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.get()}deg` }] }))
  return (
    <View
      accessibilityLabel={label}
      accessibilityLiveRegion="polite"
      accessibilityRole="progressbar"
      accessible
      style={styles.ground}
    >
      <Animated.View style={[styles.ring, spin]} />
      <WrenMark size={SIZE.loadingMark} />
    </View>
  )
}
