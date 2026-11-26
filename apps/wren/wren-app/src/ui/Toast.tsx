import { Text } from 'react-native'
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated'

import { useToastOffset } from '@/shell/useShell'
import { useToast } from '@raven/wren-native'
import { type WrenTheme, themedStyles, useWrenTheme } from '@/theme/wrenTheme'
import { RADIUS, SIZE, SPACE, TYPE } from '@/theme/wrenTokens'
import { ICONS, WrenIcon } from '@/ui/WrenIcon'

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  toast: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: colors.text,
    borderRadius: RADIUS.pill,
    flexDirection: 'row',
    gap: SPACE.s2,
    minHeight: SIZE.touchTarget,
    paddingHorizontal: SPACE.s5,
    position: 'absolute',
  },
  message: { ...TYPE.rowStrong, color: colors.bg },
}))

/**
 * The toast `useToast` raises, over every screen and clear of the tab bar and the mini player,
 * said aloud as it shows. It fades in and out, or simply shows for a listener who asked for
 * less motion.
 */
export function ToastHost() {
  const styles = useStyles()
  const { colors } = useWrenTheme()
  const message = useToast((state) => state.message)
  const bottom = useToastOffset()
  return (
    message !== null && (
      <Animated.View
        accessibilityLiveRegion="polite"
        accessibilityRole="alert"
        entering={FadeInDown}
        exiting={FadeOutDown}
        pointerEvents="none"
        style={[styles.toast, { bottom }]}
      >
        <WrenIcon color={colors.bg} name={ICONS.check} size={SIZE.smallIcon} />
        <Text style={styles.message}>{message}</Text>
      </Animated.View>
    )
  )
}
