import { Pressable, Text } from 'react-native'

import { type WrenTheme, themedStyles } from '@/theme/wrenTheme'
import { SIZE, SPACE, TYPE } from '@/theme/wrenTokens'
import { pressedStyleOf } from '@/ui/press'

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  link: { justifyContent: 'center', minHeight: SIZE.touchTarget },
  label: { ...TYPE.link, color: colors.accentText },
}))

/** A link in words: what it says, what it is called aloud when that says more, and what it does. */
export type TextAction = {
  label: string
  spoken?: string
  onPress: () => void
  /** Whether it opens a page, said as a link, rather than acting here, said as a button. */
  isLink?: boolean
}

/** A red word that acts: See all, Clear, Manage. It answers a 44 point finger. */
export function TextLink({ label, spoken, onPress, isLink = false }: TextAction) {
  const styles = useStyles()
  return (
    <Pressable
      accessibilityLabel={spoken ?? label}
      accessibilityRole={isLink ? 'link' : 'button'}
      hitSlop={SPACE.s2}
      onPress={onPress}
      style={pressedStyleOf({ style: styles.link })}
    >
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  )
}
