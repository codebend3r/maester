import { type BottomTabBarProps, Tabs } from 'expo-router/js-tabs'
import { View } from 'react-native'

import { HOME_COPY, LIBRARY_PAGE_COPY, SEARCH_COPY, SETTINGS_COPY } from '@raven/wren'
import { BAR_PLACES, NowPlayingBar } from '@/components/NowPlayingBar'
import { FORM_FACTORS, type FormFactor } from '@/theme/wrenTokens'
import { WREN_TABS } from '@/routes'
import { themedStyles, useFormFactor } from '@/theme/wrenTheme'
import { TabBar } from '@/ui/TabBar'
import { ICONS, type WrenIconName } from '@/ui/WrenIcon'

type WrenTab = (typeof WREN_TABS)[keyof typeof WREN_TABS]

/** The tab navigator's event for a press on a tab, which a listener may stop. */
const TAB_EVENTS = { press: 'tabPress' } as const

type TabLook = { title: string; icon: WrenIconName }

/** Each tab's name and drawing on the bar, in the bar's order. */
const TABS = {
  [WREN_TABS.home]: { title: HOME_COPY.title, icon: ICONS.home },
  [WREN_TABS.library]: { title: LIBRARY_PAGE_COPY.title, icon: ICONS.library },
  [WREN_TABS.search]: { title: SEARCH_COPY.title, icon: ICONS.search },
  [WREN_TABS.settings]: { title: SETTINGS_COPY.title, icon: ICONS.settings },
} as const satisfies Record<WrenTab, TabLook>

const isWrenTab = (name: string): name is WrenTab => Object.hasOwn(TABS, name)

const useStyles = themedStyles(({ colors }) => ({ scene: { backgroundColor: colors.bg } }))

const HAS_TAB_BAR = {
  [FORM_FACTORS.phone]: true,
  [FORM_FACTORS.tablet]: false,
} as const satisfies Record<FormFactor, boolean>

/** The phone's tab bar with the mini player floating on it; a tablet has its sidebar instead. */
function PhoneTabBar({ state, emitter, navigateToTab }: BottomTabBarProps) {
  const formFactor = useFormFactor()
  const items = state.routes.flatMap((route, at) => {
    if (!isWrenTab(route.name)) return []
    const isActive = at === state.index
    const onPress = () => {
      const event = emitter.emit({
        type: TAB_EVENTS.press,
        target: route.key,
        canPreventDefault: true,
      })
      if (!isActive && !event.defaultPrevented) navigateToTab(route.key)
    }
    const { title, icon } = TABS[route.name]
    return [{ key: route.key, label: title, icon, isActive, onPress }]
  })
  return (
    HAS_TAB_BAR[formFactor] && (
      <View>
        <NowPlayingBar place={BAR_PLACES.tabs} />
        <TabBar items={items} />
      </View>
    )
  )
}

const tabBarOf = (props: BottomTabBarProps) => <PhoneTabBar {...props} />

/** Wren's four tabs, Home, Library, Search and Settings, each named and drawn on the bar. */
export function WrenTabs() {
  const styles = useStyles()
  return (
    <Tabs screenOptions={{ headerShown: false, sceneStyle: styles.scene }} tabBar={tabBarOf}>
      {Object.entries(TABS).map(([name, { title }]) => (
        <Tabs.Screen key={name} name={name} options={{ title }} />
      ))}
    </Tabs>
  )
}
