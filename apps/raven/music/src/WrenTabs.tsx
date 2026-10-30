import { Icon } from '@raven/native'
import type { IconName } from '@raven/ui/iconDrawings'
import { Tabs } from 'expo-router/js-tabs'
import { StyleSheet } from 'react-native'

import { WREN_TABS } from '@/routes'
import { WREN_ICONS } from '@/theme/icons'
import { PALETTE, SIZES } from '@/theme/wrenTheme'

type WrenTab = (typeof WREN_TABS)[keyof typeof WREN_TABS]

type TabIconProps = { focused: boolean; size: number }

/** A tab's drawing on the bar, bright while its tab is the one showing. */
const tabIconOf =
  (icon: IconName) =>
  ({ focused, size }: TabIconProps) => (
    <Icon colour={focused ? PALETTE.text : PALETTE.muted} name={icon} size={size} />
  )

/** Each tab's name and drawing on the bar, in the bar's order. */
const TABS = {
  [WREN_TABS.home]: { title: 'Home', tabBarIcon: tabIconOf(WREN_ICONS.home) },
  [WREN_TABS.library]: { title: 'Library', tabBarIcon: tabIconOf(WREN_ICONS.library) },
  [WREN_TABS.search]: { title: 'Search', tabBarIcon: tabIconOf(WREN_ICONS.search) },
  [WREN_TABS.settings]: { title: 'Settings', tabBarIcon: tabIconOf(WREN_ICONS.settings) },
} as const satisfies Record<WrenTab, { title: string; tabBarIcon: ReturnType<typeof tabIconOf> }>

/** Wren's four tabs along the bottom, each named and drawn with raven's line icons. */
export function WrenTabs() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: PALETTE.ground },
        tabBarActiveTintColor: PALETTE.text,
        tabBarInactiveTintColor: PALETTE.muted,
        tabBarLabelStyle: styles.label,
        tabBarStyle: styles.bar,
      }}
    >
      {Object.entries(TABS).map(([name, options]) => (
        <Tabs.Screen key={name} name={name} options={options} />
      ))}
    </Tabs>
  )
}

const styles = StyleSheet.create({
  bar: { backgroundColor: PALETTE.raised, borderTopColor: PALETTE.line },
  label: { fontSize: SIZES.textSm, fontWeight: 'bold' },
})
