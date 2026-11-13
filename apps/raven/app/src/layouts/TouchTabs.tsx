import { Icon } from '@raven/native'
import type { IconName } from '@raven/ui/iconDrawings'
import { usePathname } from 'expo-router'
import { useCallback, useState } from 'react'
import { type LayoutChangeEvent, Pressable, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Text } from '@/layouts/Text'
import { TouchMoreSheet } from '@/layouts/TouchMoreSheet'
import { isPlayerPath } from '@/layouts/touchMenuKit'
import { TOUCH_TABS, TOUCH_TABS_COPY, type TouchTab, activeTabOf } from '@/layouts/touchTabsKit'
import { useMenuGo } from '@/layouts/useMenuGo'
import { deviceNavKind } from '@/platform/devicePlatform'
import { NAV_KINDS } from '@/platform/platform'
import type { AppQueries } from '@/queries/useAppQueries'
import { APP_ROUTES, type Href } from '@/routes'
import { OPACITIES, SIZES } from '@/theme/appTheme'
import { themedStyles, useTheme } from '@/theme/useTheme'
import { APP_ICONS } from '@/theme/icons'

/** Whether the tab bar shows: on an iPhone, anywhere but the video player. */
export const useIsTabBarShown = (): boolean => {
  const pathname = usePathname()
  return deviceNavKind() === NAV_KINDS.tabs && !isPlayerPath({ pathname })
}

type TabButtonProps = {
  icon: IconName
  label: string
  /** The name read aloud, which says in full what the one under the icon may shorten. */
  spoken: string
  isSelected: boolean
  /** Whether the tab's sheet is up; left out for a tab that opens a page. */
  isExpanded?: boolean
  onPress: () => void
}

/** One slot of the bar: its icon over its name, on the moss while it is the page's. */
const TabButton = ({ icon, label, spoken, isSelected, isExpanded, onPress }: TabButtonProps) => {
  const styles = useStyles()
  const colour = useTheme((theme) => (isSelected ? theme.palette.text : theme.palette.muted))
  return (
    <Pressable
      accessibilityLabel={spoken}
      accessibilityRole="tab"
      accessibilityState={{ selected: isSelected, expanded: isExpanded }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tab,
        isSelected && styles.tabSelected,
        pressed && styles.pressed,
      ]}
    >
      <Icon colour={colour} name={icon} size={SIZES.textXl} />
      <Text numberOfLines={1} style={[styles.tabLabel, { color: colour }]}>
        {label}
      </Text>
    </Pressable>
  )
}

type PageTab = Exclude<TouchTab, typeof TOUCH_TABS.more>

type PageTabEntry = { icon: IconName; label: string; spoken: string; href: Href }

/** The four tabs that open a page, in the bar's order. */
const PAGE_TABS = {
  [TOUCH_TABS.home]: {
    icon: APP_ICONS.home,
    label: TOUCH_TABS_COPY.home,
    spoken: TOUCH_TABS_COPY.home,
    href: { pathname: APP_ROUTES.home, params: {} },
  },
  [TOUCH_TABS.libraries]: {
    icon: APP_ICONS.libraries,
    label: TOUCH_TABS_COPY.libraries,
    spoken: TOUCH_TABS_COPY.libraries,
    href: { pathname: APP_ROUTES.libraries, params: {} },
  },
  [TOUCH_TABS.favourites]: {
    icon: APP_ICONS.heart,
    label: TOUCH_TABS_COPY.favourites,
    spoken: TOUCH_TABS_COPY.favourites,
    href: { pathname: APP_ROUTES.favourites, params: {} },
  },
  [TOUCH_TABS.continueWatching]: {
    icon: APP_ICONS.continue,
    label: TOUCH_TABS_COPY.continueShort,
    spoken: TOUCH_TABS_COPY.continueWatching,
    href: { pathname: APP_ROUTES.continueWatching, params: {} },
  },
} as const satisfies Record<PageTab, PageTabEntry>

type TouchTabsProps = { session: AppQueries }

/**
 * An iPhone's way between pages, in place of the iPad's side menu, mounted once above the
 * routes: a bar along the foot of the screen, above the home indicator, of Home, Libraries,
 * Favourites, Continue watching and More, whose sheet holds Search, Settings and the pinned
 * libraries. The bar sits under the screens and the music strip, so neither is hidden behind
 * it, and stays off the video player, whose screen is its own.
 */
export const TouchTabs = ({ session }: TouchTabsProps) => {
  const pathname = usePathname()
  const insets = useSafeAreaInsets()
  const go = useMenuGo()
  const styles = useStyles()
  const [isMoreOpen, setMoreOpen] = useState(false)
  const [barHeight, setBarHeight] = useState(0)
  const isOnPlayer = isPlayerPath({ pathname })
  const active = activeTabOf({ pathname, isMoreOpen })

  // The player opens over everything, so a sheet left up goes with the bar.
  if (isOnPlayer && isMoreOpen) setMoreOpen(false)

  const closeMore = useCallback(() => setMoreOpen(false), [])
  const onBarLayout = ({ nativeEvent }: LayoutChangeEvent) =>
    setBarHeight(nativeEvent.layout.height)

  return (
    !isOnPlayer && (
      <>
        <TouchMoreSheet
          barHeight={barHeight}
          isOpen={isMoreOpen}
          onClose={closeMore}
          session={session}
        />
        <View
          accessibilityLabel={TOUCH_TABS_COPY.bar}
          accessibilityRole="tablist"
          onLayout={onBarLayout}
          style={[
            styles.bar,
            {
              paddingBottom: Math.max(insets.bottom, SIZES.space1),
              paddingLeft: insets.left + SIZES.space1,
              paddingRight: insets.right + SIZES.space1,
            },
          ]}
        >
          {Object.entries(PAGE_TABS).map(([tab, entry]) => (
            <TabButton
              key={tab}
              icon={entry.icon}
              isSelected={active === tab}
              label={entry.label}
              spoken={entry.spoken}
              onPress={() => {
                closeMore()
                go(entry.href)
              }}
            />
          ))}
          <TabButton
            icon={APP_ICONS.more}
            isExpanded={isMoreOpen}
            isSelected={active === TOUCH_TABS.more}
            label={TOUCH_TABS_COPY.more}
            spoken={TOUCH_TABS_COPY.more}
            onPress={() => setMoreOpen((isOpen) => !isOpen)}
          />
        </View>
      </>
    )
  )
}

const useStyles = themedStyles((colours) =>
  StyleSheet.create({
    bar: {
      flexDirection: 'row',
      gap: SIZES.space1,
      paddingTop: SIZES.space1,
      backgroundColor: colours.raised,
      borderTopWidth: 1,
      borderTopColor: colours.line,
    },
    tab: {
      flex: 1,
      alignItems: 'center',
      gap: SIZES.space0,
      paddingVertical: SIZES.space1,
      borderRadius: SIZES.radius,
    },
    tabSelected: { backgroundColor: colours.quiet },
    tabLabel: { fontSize: SIZES.textXs, fontWeight: '700' },
    pressed: { opacity: OPACITIES.pressed },
  }),
)
