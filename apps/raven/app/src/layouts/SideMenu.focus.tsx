import type { IconName } from '@raven/ui/iconDrawings'
import { type ComponentRef, type Ref, useRef } from 'react'
import { Pressable, ScrollView, StyleSheet } from 'react-native'

import { Text } from '@/layouts/Text'
import { useOpenerFocus, useOpeningFocus } from '@/layouts/focus'
import { Icon } from '@raven/native'
import { PickerList, usePickerList } from '@/layouts/Picker.focus'
import {
  MENU_FOOT,
  PINNED_HEADING,
  SEARCH_EVERY_LIBRARY,
  SETTINGS_ENTRY,
  type MenuLibrary,
  type ShelvesProps,
} from '@/layouts/shelfKit'
import { useAppPrefs } from '@/stores/appPrefs'
import { useSideMenu } from '@/stores/sideMenu'
import { THEME_PICKER } from '@/theme/themeOptions'
import { TV_SIZES } from '@/theme/tvSizes'
import { themedStyles, useTheme } from '@/theme/useTheme'

/** Where the Settings entry sits on Home, a place no shelf's card shares. */
const SETTINGS_PLACE = 'settings'

/** How wide a side menu icon stands: the size of the menu's own type, larger. */
const MENU_ICON = TV_SIZES.textXl

type MenuRowProps = {
  label: string
  icon: IconName
  onPress: () => void
  ref?: Ref<ComponentRef<typeof Pressable>>
}

/**
 * One row of the side menu: its icon and a link the remote moves down, its edge and fill showing
 * focus. Folded, the row is its icon alone, and its label is what it is called aloud.
 */
const MenuRow = ({ label, icon, onPress, ref }: MenuRowProps) => {
  const { settle } = useOpeningFocus()
  const isCollapsed = useSideMenu((menu) => menu.isCollapsed)
  const text = useTheme((theme) => theme.palette.text)
  const styles = useStyles()
  return (
    <Pressable
      ref={ref}
      accessibilityLabel={label}
      accessibilityRole="link"
      onFocus={settle}
      onPress={onPress}
      style={({ focused }) => [styles.row, focused && styles.focused]}
    >
      {({ focused }) => (
        <>
          <Icon colour={text} isFocused={focused} name={icon} size={MENU_ICON} />
          {!isCollapsed && (
            <Text numberOfLines={1} style={styles.label}>
              {label}
            </Text>
          )}
        </>
      )}
    </Pressable>
  )
}

type SettingsEntryProps = { onPress: () => void }

/**
 * The way into Settings, which takes the remote's focus back when Settings goes, as a card does
 * for the screen it opened: Android TV restores nothing on its own.
 */
const SettingsEntry = ({ onPress }: SettingsEntryProps) => {
  const view = useRef<ComponentRef<typeof Pressable>>(null)
  const { remember } = useOpenerFocus({ place: SETTINGS_PLACE, view })
  return (
    <MenuRow
      ref={view}
      icon="settings"
      label={SETTINGS_ENTRY.label}
      onPress={() => {
        remember()
        onPress()
      }}
    />
  )
}

/**
 * The theme, as the web's picker at the foot of its side menu: the row names the theme worn and
 * opens the TV's picker list over the screen, focus on that theme. Picking one wears it at once
 * and keeps it on this device, as Settings' choice does.
 */
const ThemeChoice = () => {
  const theme = useAppPrefs((prefs) => prefs.theme)
  const change = useAppPrefs((prefs) => prefs.change)
  const { open, label, list } = usePickerList({
    ...THEME_PICKER,
    value: theme,
    onChoose: (picked) => change({ theme: picked }),
  })
  return (
    <>
      <MenuRow icon="sun" label={label} onPress={open} />
      <PickerList {...list} />
    </>
  )
}

type SideMenuProps = Pick<ShelvesProps, 'onSearch' | 'onSettings' | 'onOpenLibrary' | 'libraries'>

/**
 * The side menu, as the web's: the search, then the pinned libraries under their heading, each
 * with its icon, and at the foot Settings, the theme and the toggle that folds the menu down to
 * its icons, kept on this device. It is the left column of Home on a TV, the remote's way to every
 * library.
 */
export const SideMenu = ({ libraries, onSearch, onSettings, onOpenLibrary }: SideMenuProps) => {
  const isCollapsed = useSideMenu((menu) => menu.isCollapsed)
  const toggle = useSideMenu((menu) => menu.toggle)
  const styles = useStyles()
  return (
    <ScrollView
      contentContainerStyle={styles.content}
      style={[styles.menu, isCollapsed && styles.collapsed]}
    >
      <MenuRow icon="search" label={SEARCH_EVERY_LIBRARY.text} onPress={onSearch} />
      {libraries.length > 0 && !isCollapsed && (
        <Text accessibilityRole="header" style={styles.heading}>
          {PINNED_HEADING}
        </Text>
      )}
      {libraries.map((library: MenuLibrary) => (
        <MenuRow
          key={library.id}
          icon={library.icon}
          label={library.name}
          onPress={() => onOpenLibrary(library.id)}
        />
      ))}
      <SettingsEntry onPress={onSettings} />
      <ThemeChoice />
      <MenuRow
        icon="sidebar"
        label={isCollapsed ? MENU_FOOT.expand : MENU_FOOT.collapse}
        onPress={toggle}
      />
    </ScrollView>
  )
}

const useStyles = themedStyles((colours) =>
  StyleSheet.create({
    menu: { flexGrow: 0, width: TV_SIZES.space8 * 5, backgroundColor: colours.raised },
    // The icons alone: an icon inside its row's padding and ring, inside the menu's padding.
    collapsed: {
      width: MENU_ICON + 2 * (TV_SIZES.space3 + TV_SIZES.space2 + TV_SIZES.tvFocusRing),
    },
    content: {
      gap: TV_SIZES.space1,
      paddingHorizontal: TV_SIZES.space3,
      paddingVertical: TV_SIZES.space6,
    },
    heading: {
      color: colours.muted,
      fontSize: TV_SIZES.textSm,
      fontWeight: '600',
      paddingHorizontal: TV_SIZES.space2,
      paddingTop: TV_SIZES.space4,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TV_SIZES.space2,
      borderColor: 'transparent',
      borderRadius: TV_SIZES.radius,
      borderWidth: TV_SIZES.tvFocusRing,
      paddingHorizontal: TV_SIZES.space2,
      paddingVertical: TV_SIZES.space1,
    },
    focused: { borderColor: colours.text, backgroundColor: colours.quiet },
    label: { color: colours.text, fontSize: TV_SIZES.textLg, fontWeight: '600' },
  }),
)
