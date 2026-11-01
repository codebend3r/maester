import { Icon } from '@raven/native'
import type { IconName } from '@raven/ui/iconDrawings'
import { useQuery } from '@tanstack/react-query'
import { usePathname, useRouter } from 'expo-router'
import { type ComponentRef, type Ref, useEffect, useMemo, useState } from 'react'
import {
  Animated,
  Easing,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { PINNED_HEADING, SETTINGS_ENTRY } from '@/layouts/shelfKit'
import { Text, TEXT_VARIANTS } from '@/layouts/Text'
import {
  MENU_EDGE_WIDTH,
  MENU_SLIDE_MS,
  TOUCH_NAV_COPY,
  hasEdgeSwipe,
  isClosedBy,
  isOpenedBy,
  isPlayerPath,
  menuMoveOf,
  menuWidthOf,
} from '@/layouts/touchMenuKit'
import { pinnedLibrariesOf } from '@/queries/pinnedLibraries'
import type { AppQueries } from '@/queries/useAppQueries'
import { APP_ROUTES, type Href, ROUTE_TARGETS, hrefOf } from '@/routes'
import { useReduceMotion } from '@/stores/reduceMotion'
import { useTouchMenu } from '@/stores/touchMenu'
import { OPACITIES, SIZES } from '@/theme/appTheme'
import { themedStyles, useTheme } from '@/theme/useTheme'

/** How dark the page behind the open menu goes. */
const SCRIM_OPACITY = 0.5

/** How far a sideways drag must go before it is a swipe and not a tap that wandered. */
const SWIPE_START = 12

type SlideProps = {
  progress: Animated.Value
  to: number
  isReduced: boolean
  onShut: () => void
}

/** Slides the menu to `to`, 0 shut or 1 out, at once when the system asks for less motion. */
const slide = ({ progress, to, isReduced, onShut }: SlideProps) => {
  if (isReduced) {
    progress.setValue(to)
    if (to === 0) onShut()
    return
  }
  Animated.timing(progress, {
    toValue: to,
    duration: MENU_SLIDE_MS,
    easing: Easing.out(Easing.cubic),
    useNativeDriver: true,
  }).start(({ finished }) => {
    if (finished && to === 0) onShut()
  })
}

type MenuEntryProps = {
  icon: IconName
  label: string
  onPress: () => void
  ref?: Ref<ComponentRef<typeof Pressable>>
}

/** One row of the menu: its icon and its name, a finger tall. */
const MenuEntry = ({ icon, label, onPress, ref }: MenuEntryProps) => {
  const styles = useStyles()
  const text = useTheme((theme) => theme.palette.text)
  return (
    <Pressable
      ref={ref}
      accessibilityLabel={label}
      accessibilityRole="link"
      onPress={onPress}
      style={({ pressed }) => [styles.entry, pressed && styles.pressed]}
    >
      <Icon colour={text} name={icon} size={SIZES.textXl} />
      <Text numberOfLines={1} style={styles.entryLabel}>
        {label}
      </Text>
    </Pressable>
  )
}

type MenuContentProps = { session: AppQueries }

/**
 * What the menu holds, in the web's side menu's order: Home and Favourites, the
 * pinned libraries under their heading, a rule, then Settings. Choosing an entry shuts the
 * menu and goes there.
 */
const MenuContent = ({ session: { queries } }: MenuContentProps) => {
  const router = useRouter()
  const pathname = usePathname()
  const close = useTouchMenu((menu) => menu.close)
  const libraries = useQuery(queries.librariesQuery)
  const insets = useSafeAreaInsets()
  const styles = useStyles()
  const pinned = pinnedLibrariesOf(libraries.data ?? [])
  const go = (href: Href) => {
    close()
    router[menuMoveOf({ pathname })](href)
  }
  return (
    <ScrollView
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + SIZES.space3, paddingBottom: insets.bottom + SIZES.space5 },
      ]}
      keyboardShouldPersistTaps="handled"
    >
      <MenuEntry
        icon="home"
        label={TOUCH_NAV_COPY.home}
        onPress={() => {
          close()
          router.dismissTo(APP_ROUTES.home)
        }}
      />
      <MenuEntry
        icon="heart"
        label={TOUCH_NAV_COPY.favourites}
        onPress={() => go({ pathname: APP_ROUTES.favourites, params: {} })}
      />
      {pinned.length > 0 && (
        <Text variant={TEXT_VARIANTS.display} accessibilityRole="header" style={styles.heading}>
          {PINNED_HEADING}
        </Text>
      )}
      {pinned.map((library) => (
        <MenuEntry
          key={library.id}
          icon={library.icon}
          label={library.name}
          onPress={() =>
            go(hrefOf({ kind: ROUTE_TARGETS.library, libraryId: library.id, query: '' }))
          }
        />
      ))}
      <View accessibilityElementsHidden importantForAccessibility="no" style={styles.divider} />
      <MenuEntry
        icon="settings"
        label={SETTINGS_ENTRY.label}
        onPress={() => go({ pathname: APP_ROUTES.settings, params: {} })}
      />
    </ScrollView>
  )
}

type DrawerProps = { session: AppQueries }

/**
 * The menu slid out over the page: a dimmed scrim that shuts it when pressed, and the panel,
 * which a swipe back shuts too. It is drawn only while open or sliding; shut, nothing of it is
 * in the way of the page.
 */
const Drawer = ({ session }: DrawerProps) => {
  const window = useWindowDimensions()
  const width = menuWidthOf(window.width)
  const isOpen = useTouchMenu((menu) => menu.isOpen)
  const close = useTouchMenu((menu) => menu.close)
  const isReduced = useReduceMotion((motion) => motion.isReduced)
  const [progress] = useState(() => new Animated.Value(0))
  const [isDrawn, setDrawn] = useState(false)
  const scrimStyles = useStyles({ isOverPicture: true })
  const styles = useStyles()

  // Opening draws the panel in this render, so the slide has it to move.
  if (isOpen && !isDrawn) setDrawn(true)

  useEffect(() => {
    // Open, but not drawn yet: the slide starts once the panel is there to move.
    if (isOpen && !isDrawn) return
    slide({ progress, to: isOpen ? 1 : 0, isReduced, onShut: () => setDrawn(false) })
  }, [isOpen, isDrawn, isReduced, progress])

  const swipeBack = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, { dx, dy }) =>
          dx < -SWIPE_START && Math.abs(dx) > Math.abs(dy),
        onPanResponderRelease: (_, { dx, vx }) => {
          if (isClosedBy({ dx, vx })) close()
        },
      }),
    [close],
  )

  return (
    isDrawn && (
      <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            scrimStyles.scrim,
            {
              opacity: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [0, SCRIM_OPACITY],
              }),
            },
          ]}
        >
          <Pressable
            accessibilityLabel={TOUCH_NAV_COPY.closeMenu}
            accessibilityRole="button"
            onPress={close}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
        <Animated.View
          {...swipeBack.panHandlers}
          accessibilityLabel={TOUCH_NAV_COPY.sideMenu}
          accessibilityViewIsModal
          onAccessibilityEscape={close}
          style={[
            styles.panel,
            {
              width,
              transform: [
                {
                  translateX: progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-width, 0],
                  }),
                },
              ],
            },
          ]}
        >
          <MenuContent session={session} />
        </Animated.View>
      </View>
    )
  )
}

/** A strip down the left edge of Home that a swipe in from it slides the menu out from. */
const EdgeSwipe = () => {
  const open = useTouchMenu((menu) => menu.open)
  const swipeOut = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, { dx, dy }) =>
          dx > SWIPE_START && Math.abs(dx) > Math.abs(dy),
        onPanResponderRelease: (_, { dx, vx }) => {
          if (isOpenedBy({ dx, vx })) open()
        },
      }),
    [open],
  )
  const styles = useStyles()
  return <View {...swipeOut.panHandlers} style={styles.edge} />
}

type TouchMenuProps = { session: AppQueries }

/**
 * The side menu of a phone or tablet, mounted once above the routes: out from a menu button in
 * a page's header, or from a swipe in from Home's left edge; the web's side menu's content,
 * Home, Favourites, the pinned libraries and, below a rule, Settings. It stays off the video
 * player, whose screen is its own, and shuts itself when the player opens.
 */
export const TouchMenu = ({ session }: TouchMenuProps) => {
  const pathname = usePathname()
  const isOpen = useTouchMenu((menu) => menu.isOpen)
  const close = useTouchMenu((menu) => menu.close)
  const isOnPlayer = isPlayerPath({ pathname })
  useEffect(() => {
    if (isOnPlayer) close()
  }, [isOnPlayer, close])
  return (
    !isOnPlayer && (
      <>
        {!isOpen && hasEdgeSwipe({ pathname }) && <EdgeSwipe />}
        <Drawer session={session} />
      </>
    )
  )
}

const useStyles = themedStyles((colours) =>
  StyleSheet.create({
    scrim: { backgroundColor: colours.ground },
    panel: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      left: 0,
      backgroundColor: colours.ground,
      borderRightWidth: 1,
      borderRightColor: colours.line,
    },
    edge: { position: 'absolute', top: 0, bottom: 0, left: 0, width: MENU_EDGE_WIDTH },
    content: { gap: SIZES.space1, paddingHorizontal: SIZES.space3 },
    heading: {
      color: colours.muted,
      fontSize: SIZES.textSm,
      fontWeight: '600',
      paddingTop: SIZES.space3,
    },
    divider: { height: 1, backgroundColor: colours.line, marginVertical: SIZES.space2 },
    entry: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: SIZES.space2,
      minHeight: SIZES.fieldHeight,
      borderRadius: SIZES.radius,
    },
    entryLabel: { flexShrink: 1, color: colours.text, fontSize: SIZES.textLg, fontWeight: '600' },
    pressed: { opacity: OPACITIES.pressed },
  }),
)
