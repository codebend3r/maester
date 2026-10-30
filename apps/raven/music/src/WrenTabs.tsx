import { Tabs } from 'expo-router/js-tabs'
import { StyleSheet } from 'react-native'

import { WREN_TABS } from '@/routes'
import { PALETTE, SIZES } from '@/theme/wrenTheme'

/** Each tab's name on the bar, in the bar's order. */
const TAB_TITLES = {
  [WREN_TABS.home]: 'Home',
  [WREN_TABS.library]: 'Library',
  [WREN_TABS.search]: 'Search',
  [WREN_TABS.settings]: 'Settings',
} as const satisfies Record<(typeof WREN_TABS)[keyof typeof WREN_TABS], string>

/**
 * Wren's four tabs along the bottom, named in words: the bar draws no icons until Wren has
 * drawings of its own, so a missing icon's placeholder is hidden.
 */
export function WrenTabs() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: PALETTE.ground },
        tabBarActiveTintColor: PALETTE.text,
        tabBarInactiveTintColor: PALETTE.muted,
        tabBarIconStyle: styles.icon,
        tabBarLabelStyle: styles.label,
        tabBarStyle: styles.bar,
      }}
    >
      {Object.entries(TAB_TITLES).map(([name, title]) => (
        <Tabs.Screen key={name} name={name} options={{ title }} />
      ))}
    </Tabs>
  )
}

const styles = StyleSheet.create({
  bar: { backgroundColor: PALETTE.raised, borderTopColor: PALETTE.line },
  icon: { display: 'none' },
  label: { fontSize: SIZES.text, fontWeight: 'bold' },
})
