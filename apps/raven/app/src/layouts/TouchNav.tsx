import { Icon } from '@raven/native'
import type { IconName } from '@raven/ui/iconDrawings'
import { useRouter } from 'expo-router'
import { type ComponentRef, type ReactNode, type Ref, useRef } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'

import { openPickerSheet } from '@/layouts/Picker.touch'
import { TouchBack } from '@/layouts/TouchBack'
import { TOUCH_NAV_COPY } from '@/layouts/touchMenuKit'
import { APP_ROUTES } from '@/routes'
import { useAppPrefs } from '@/stores/appPrefs'
import { useTouchMenu } from '@/stores/touchMenu'
import { OPACITIES, SIZES } from '@/theme/appTheme'
import { THEME_PICKER } from '@/theme/themeOptions'
import { themedStyles, useTheme } from '@/theme/useTheme'

type NavButtonProps = {
  icon: IconName
  label: string
  onPress: () => void
  isRaised: boolean
  ref?: Ref<ComponentRef<typeof Pressable>>
}

/** An icon button of the header, as tall as a finger needs; raised, it sits on the picture's glass. */
const NavButton = ({ icon, label, onPress, isRaised, ref }: NavButtonProps) => {
  const styles = useStyles({ isOverPicture: isRaised })
  const text = useTheme((theme) => (isRaised ? theme.overPicture.text : theme.palette.text))
  return (
    <Pressable
      ref={ref}
      accessibilityLabel={label}
      accessibilityRole="button"
      hitSlop={SIZES.space1}
      onPress={onPress}
      style={({ pressed }) => [styles.button, isRaised && styles.raised, pressed && styles.pressed]}
    >
      <Icon colour={text} name={icon} size={SIZES.textXl} />
    </Pressable>
  )
}

type NavPartProps = { isRaised: boolean }

type HomeButtonProps = NavPartProps

/** Back to Home, taking the screens above it off the stack rather than stacking another. */
const HomeButton = ({ isRaised }: HomeButtonProps) => {
  const router = useRouter()
  return (
    <NavButton
      icon="home"
      isRaised={isRaised}
      label={TOUCH_NAV_COPY.home}
      onPress={() => router.dismissTo(APP_ROUTES.home)}
    />
  )
}

type MenuButtonProps = NavPartProps

/** Slides the side menu out over the page. */
const MenuButton = ({ isRaised }: MenuButtonProps) => {
  const open = useTouchMenu((menu) => menu.open)
  return <NavButton icon="sidebar" isRaised={isRaised} label={TOUCH_NAV_COPY.menu} onPress={open} />
}

type ThemeButtonProps = NavPartProps

/**
 * The theme swap, in the header's top right as the web's corner button is: it opens the system's
 * sheet of themes, a popover on an iPad, and wears the pick at once, keeping it on this device.
 */
const ThemeButton = ({ isRaised }: ThemeButtonProps) => {
  const button = useRef<ComponentRef<typeof Pressable>>(null)
  const change = useAppPrefs((prefs) => prefs.change)
  return (
    <NavButton
      ref={button}
      icon="sun"
      isRaised={isRaised}
      label={TOUCH_NAV_COPY.theme}
      onPress={() =>
        openPickerSheet({
          ...THEME_PICKER,
          anchor: button,
          isOverPicture: isRaised,
          onChoose: (theme) => change({ theme }),
        })
      }
    />
  )
}

type TouchNavProps = {
  /** The way back; left out where there is nothing behind the page. */
  onBack?: () => void
  /** Drawn on the picture's dark glass, for where the header sits over a picture. */
  isRaised?: boolean
  /** Home itself: no Home button. */
  isHome?: boolean
  /** A search field under the buttons, for the pages that search. */
  search?: ReactNode
}

/**
 * The header every touch page opens with, once for all of them: Back, Home and the menu at the
 * left, the theme swap at the right, and the search field under them where a page has one.
 * Home stays out of Home's own header; the player has its own chrome.
 */
export const TouchNav = ({ onBack, isRaised = false, isHome = false, search }: TouchNavProps) => {
  const styles = useStyles()
  return (
    <View style={styles.nav}>
      <View style={styles.bar}>
        <View style={styles.side}>
          {onBack !== undefined && <TouchBack isRaised={isRaised} onPress={onBack} />}
          {!isHome && <HomeButton isRaised={isRaised} />}
          <MenuButton isRaised={isRaised} />
        </View>
        <ThemeButton isRaised={isRaised} />
      </View>
      {search}
    </View>
  )
}

const useStyles = themedStyles((colours) =>
  StyleSheet.create({
    nav: { gap: SIZES.space2 },
    bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    side: { flexDirection: 'row', alignItems: 'center', gap: SIZES.space2 },
    button: {
      minWidth: SIZES.fieldHeight,
      minHeight: SIZES.fieldHeight,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: SIZES.radius,
    },
    raised: { backgroundColor: colours.raised },
    pressed: { opacity: OPACITIES.pressed },
  }),
)
