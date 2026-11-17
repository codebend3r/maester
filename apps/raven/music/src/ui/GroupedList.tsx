import { Children, type ReactNode, isValidElement } from 'react'
import { Text, View } from 'react-native'

import { type WrenTheme, themedStyles } from '@/theme/wrenTheme'
import { RADIUS, SIZE, SPACE, TYPE } from '@/theme/wrenTokens'

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  group: { gap: SPACE.s2 },
  heading: { ...TYPE.overline, color: colors.text3, paddingHorizontal: SPACE.s1 },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderRadius: RADIUS.lg,
    borderWidth: SIZE.hairline,
    overflow: 'hidden',
  },
  item: { paddingHorizontal: SPACE.s4 },
  divided: { borderTopColor: colors.line, borderTopWidth: SIZE.hairline },
}))

/** A row's own key, which `Children.toArray` gives every element. */
const keyOf = (child: ReactNode): string =>
  isValidElement(child) ? String(child.key) : String(child)

type GroupedListProps = {
  /** The overline above the card: "Server", "Downloads". */
  heading?: string
  children: ReactNode
}

/** A card of rows, divided by hairlines, under an overline heading: Settings' groups. */
export function GroupedList({ heading, children }: GroupedListProps) {
  const styles = useStyles()
  return (
    <View style={styles.group}>
      {heading !== undefined && (
        <Text accessibilityRole="header" style={styles.heading}>
          {heading}
        </Text>
      )}
      <View style={styles.card}>
        {Children.toArray(children).map((child, at) => (
          <View key={keyOf(child)} style={[styles.item, at > 0 && styles.divided]}>
            {child}
          </View>
        ))}
      </View>
    </View>
  )
}
