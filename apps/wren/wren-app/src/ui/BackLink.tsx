import { Pressable, Text } from 'react-native'

import { KIT_COPY } from '@raven/wren'
import { type WrenTheme, themedStyles, useWrenTheme } from '@/theme/wrenTheme'
import { SIZE, TYPE } from '@/theme/wrenTokens'
import { pressedStyleOf } from '@/ui/press'
import { ICONS, WrenIcon } from '@/ui/WrenIcon'

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  back: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    flexDirection: 'row',
    minHeight: SIZE.touchTarget,
  },
  label: { ...TYPE.rowTitle, color: colors.accentText },
}))

type BackLinkProps = {
  /** The page it returns to, shown and said: "Back to Library". Left out, it reads "Back". */
  to?: string
  onPress: () => void
}

/** "< Library" in red above a page the stack pushed: the way back to the page it came from. */
export function BackLink({ to, onPress }: BackLinkProps) {
  const styles = useStyles()
  const { colors } = useWrenTheme()
  return (
    <Pressable
      accessibilityLabel={to === undefined ? KIT_COPY.backAlone : KIT_COPY.back(to)}
      accessibilityRole="link"
      onPress={onPress}
      style={pressedStyleOf({ style: styles.back })}
    >
      <WrenIcon color={colors.accentText} name={ICONS.back} size={SIZE.icon} />
      <Text style={styles.label}>{to ?? KIT_COPY.backAlone}</Text>
    </Pressable>
  )
}
