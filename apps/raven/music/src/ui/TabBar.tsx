import { Pressable, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { TAB_COPY } from '@raven/wren'
import { type WrenTheme, themedStyles, useWrenTheme } from '@/theme/wrenTheme'
import { RADIUS, SIZE, SPACE, TYPE } from '@/theme/wrenTokens'
import { pressedStyleOf } from '@/ui/press'
import { WrenIcon, type WrenIconName } from '@/ui/WrenIcon'

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  bar: {
    backgroundColor: colors.bg,
    borderTopColor: colors.line,
    borderTopWidth: SIZE.hairline,
    flexDirection: 'row',
    minHeight: SIZE.tabBar,
    paddingTop: SPACE.s2,
  },
  item: { alignItems: 'center', flex: 1, gap: SPACE.s1, minHeight: SIZE.touchTarget },
  pill: {
    alignItems: 'center',
    borderRadius: RADIUS.pill,
    height: SIZE.tabPillHeight,
    justifyContent: 'center',
    width: SIZE.tabPillWidth,
  },
  activePill: { backgroundColor: colors.accentSoft },
  label: { ...TYPE.tab, color: colors.text3 },
  activeLabel: { ...TYPE.tabActive, color: colors.text },
}))

/** One tab on the bar: its name, its drawing, whether it shows, and what a press does. */
type TabItem = {
  key: string
  label: string
  icon: WrenIconName
  isActive: boolean
  onPress: () => void
}

type TabBarProps = { items: readonly TabItem[] }

/**
 * The phone's tab bar: each tab's icon in a pill over its name, the one showing in red on a
 * soft red pill. It sits over the home indicator and counts it in its height.
 */
export function TabBar({ items }: TabBarProps) {
  const styles = useStyles()
  const { colors } = useWrenTheme()
  const { bottom } = useSafeAreaInsets()
  return (
    <View accessibilityRole="tablist" style={[styles.bar, { paddingBottom: bottom }]}>
      {items.map((item, at) => (
        <Pressable
          accessibilityLabel={TAB_COPY.label({ label: item.label, at, count: items.length })}
          accessibilityRole="button"
          accessibilityState={{ selected: item.isActive }}
          key={item.key}
          onPress={item.onPress}
          style={pressedStyleOf({ style: styles.item })}
        >
          <View style={[styles.pill, item.isActive && styles.activePill]}>
            <WrenIcon
              color={item.isActive ? colors.accentText : colors.text3}
              name={item.icon}
              size={SIZE.icon}
              strokeWidth={item.isActive ? SIZE.activeStroke : SIZE.stroke}
            />
          </View>
          <Text style={item.isActive ? styles.activeLabel : styles.label}>{item.label}</Text>
        </Pressable>
      ))}
    </View>
  )
}
