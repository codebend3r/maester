import { WREN_ICONS } from '@raven/wren'
import { Text, View } from 'react-native'

import { useToast } from '@raven/wren-native'
import { RADIUS, SIZE, SPACE, TYPE } from '@/theme/tvTokens'
import { themedStyles, useWrenTheme } from '@/theme/wrenTheme'
import { WrenIcon } from '@/ui/WrenIcon'

const useStyles = themedStyles(({ colors }) => ({
  toast: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: colors.text,
    borderRadius: RADIUS.pill,
    bottom: SPACE.gutter,
    flexDirection: 'row',
    gap: SPACE.s2,
    minHeight: SIZE.button,
    paddingHorizontal: SPACE.s4,
    position: 'absolute',
  },
  message: { ...TYPE.button, color: colors.bg },
}))

/**
 * The toast `useToast` raises, over every screen at the foot of the TV, said aloud as it shows.
 * It never takes the remote's focus.
 */
export function ToastHost() {
  const styles = useStyles()
  const { colors } = useWrenTheme()
  const message = useToast((state) => state.message)
  return (
    message !== null && (
      <View
        accessibilityLiveRegion="polite"
        accessibilityRole="alert"
        pointerEvents="none"
        style={styles.toast}
      >
        <WrenIcon color={colors.bg} name={WREN_ICONS.check} size={SIZE.iconSmall} />
        <Text style={styles.message}>{message}</Text>
      </View>
    )
  )
}
