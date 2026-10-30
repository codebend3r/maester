import { Icon } from '@raven/native'
import type { IconName } from '@raven/ui/iconDrawings'
import { BottomTabBar, type BottomTabBarProps, Tabs } from 'expo-router/js-tabs'
import { StyleSheet, View } from 'react-native'

import { BAR_PLACES, NowPlayingBar } from '@/components/NowPlayingBar'
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

/** The tab bar with the now-playing bar sitting on it. */
const tabBarOf = (props: BottomTabBarProps) => (
  <View>
    <NowPlayingBar place={BAR_PLACES.tabs} />
    <BottomTabBar {...props} />
  </View>
)

/** Wren's four tabs along the bottom, each named and drawn with raven's line icons, the bar above them. */
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
      tabBar={tabBarOf}
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
