import { Pressable, Text, View } from 'react-native'

import { type WrenTheme, themedStyles, useWrenTheme } from '@/theme/wrenTheme'
import { SIZE, SPACE, TYPE } from '@/theme/wrenTokens'
import { pressedStyleOf } from '@/ui/press'
import { WrenIcon, type WrenIconName } from '@/ui/WrenIcon'

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  groups: { paddingTop: SPACE.s2 },
  group: { paddingVertical: SPACE.s1 },
  separated: { borderTopColor: colors.line, borderTopWidth: SIZE.hairline },
  action: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: SPACE.s4,
    minHeight: SIZE.buttonLarge,
    paddingHorizontal: SPACE.s4,
  },
  label: { ...TYPE.rowTitle, color: colors.text, flex: 1 },
}))

/** One of a sheet's actions: its icon and what it does. */
type SheetAction = { icon: WrenIconName; label: string; onPress: () => void }

type SheetActionsProps = {
  /** The actions in groups, a line between each: the queue's, the library's, where to go. */
  groups: readonly (readonly SheetAction[])[]
}

/** A sheet's actions, 52 tall each, grouped with a line between the groups. */
export function SheetActions({ groups }: SheetActionsProps) {
  const styles = useStyles()
  const { colors } = useWrenTheme()
  return (
    <View style={styles.groups}>
      {groups
        .filter((group) => group.length > 0)
        .map((group, at) => (
          <View key={group[0]?.label ?? at} style={[styles.group, at > 0 && styles.separated]}>
            {group.map(({ icon, label, onPress }) => (
              <Pressable
                accessibilityLabel={label}
                accessibilityRole="button"
                key={label}
                onPress={onPress}
                style={pressedStyleOf({ style: styles.action })}
              >
                <WrenIcon color={colors.text} name={icon} size={SIZE.icon} />
                <Text numberOfLines={1} style={styles.label}>
                  {label}
                </Text>
              </Pressable>
            ))}
          </View>
        ))}
    </View>
  )
}
