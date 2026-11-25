import type { ReactNode } from 'react'
import { type StyleProp, View, type ViewStyle } from 'react-native'

import { type WrenTheme, themedStyles } from '@/theme/wrenTheme'
import { RADIUS, SIZE } from '@/theme/wrenTokens'

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderRadius: RADIUS.lg,
    borderWidth: SIZE.hairline,
    overflow: 'hidden',
  },
}))

type CardProps = {
  /** How the card lays out what it holds: its padding, gap and direction. */
  style?: StyleProp<ViewStyle>
  children: ReactNode
}

/** A raised surface on the ground: a quiet fill in a hairline ring, rounded. */
export function Card({ style, children }: CardProps) {
  const styles = useStyles()
  return <View style={[styles.card, style]}>{children}</View>
}
