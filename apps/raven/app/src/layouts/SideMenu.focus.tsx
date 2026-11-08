import type { IconName } from '@raven/ui/iconDrawings'
import { useRouter } from 'expo-router'
import { type ComponentRef, type Ref, useRef } from 'react'
import { Pressable, ScrollView, StyleSheet } from 'react-native'

import { Text, TEXT_VARIANTS } from '@/layouts/Text'
import { FOCUS_FRONT } from '@/layouts/focusFront'
import { LIBRARIES_ENTRY } from '@/layouts/copy'
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
import { CONTINUE_WATCHING } from '@/queries/homeShelves'
import { APP_ROUTES } from '@/routes'
import { useAppPrefs } from '@/stores/appPrefs'
import { isMenuOpen, useSideMenu } from '@/stores/sideMenu'
import { THEME_PICKER } from '@/theme/themeOptions'
import { TV_SIZES } from '@/theme/tvSizes'
import { themedStyles, useTheme } from '@/theme/useTheme'

/** Where the entries that open a screen sit on Home, places no shelf's card shares. */
const MENU_PLACES = {
  settings: 'settings',
  continueWatching: 'continue-watching',
  libraries: 'libraries',
} as const

/** How wide a side menu icon stands: the size of the menu's own type, larger. */
const MENU_ICON = TV_SIZES.textXl

/** How wide the menu stands open. */
const OPEN_WIDTH = TV_SIZES.space8 * 5

/** How wide it stands folded: an icon inside its row's padding and ring, inside the menu's padding. */
const FOLDED_WIDTH = MENU_ICON + 2 * (TV_SIZES.space3 + TV_SIZES.space2 + TV_SIZES.tvFocusRing)

/** Lines a label may take while the remote is elsewhere; the one it is on shows whole. */
const LABEL_LINES = 2

/**
 * How much room the menu keeps beside the page: its open width while pinned, else its folded
 * width, since a folded menu opens over the page rather than pushing it along.
 */
export const useSideMenuRoom = (): number =>
  useSideMenu((menu) => (menu.isPinned ? OPEN_WIDTH : FOLDED_WIDTH))

type MenuRowProps = {
  label: string
  icon: IconName
  onPress: () => void
  ref?: Ref<ComponentRef<typeof Pressable>>
}

/**
 * One row of the side menu: its icon and a link the remote moves down, its edge and fill showing
 * focus. Folded, the row is its icon alone, and its label is what it is called aloud; open, a long
 * label takes a second line, and the row the remote is on shows its label whole.
 */
const MenuRow = ({ label, icon, onPress, ref }: MenuRowProps) => {
  const { settle } = useOpeningFocus()
  const isOpen = useSideMenu(isMenuOpen)
  const enter = useSideMenu((menu) => menu.enter)
  const leave = useSideMenu((menu) => menu.leave)
  const text = useTheme((theme) => theme.palette.text)
  const styles = useStyles()
  return (
    <Pressable
      ref={ref}
      accessibilityLabel={label}
      accessibilityRole="link"
      onBlur={leave}
      onFocus={() => {
        enter()
        settle()
      }}
      onPress={onPress}
      style={({ focused }) => [styles.row, focused && styles.focused]}
    >
      {({ focused }) => (
        <>
          <Icon colour={text} isFocused={focused} name={icon} size={MENU_ICON} />
          {isOpen && (
            <Text numberOfLines={focused ? undefined : LABEL_LINES} style={styles.label}>
              {label}
            </Text>
          )}
        </>
      )}
    </Pressable>
  )
}

type OpenerRowProps = Omit<MenuRowProps, 'ref'> & {
  place: (typeof MENU_PLACES)[keyof typeof MENU_PLACES]
}

/**
 * A row that opens a screen and takes the remote's focus back when that screen goes, as a card
 * does for the screen it opened: Android TV restores nothing on its own.
 */
const OpenerRow = ({ place, onPress, ...row }: OpenerRowProps) => {
  const view = useRef<ComponentRef<typeof Pressable>>(null)
  const { remember } = useOpenerFocus({ place, view })
  return (
    <MenuRow
      {...row}
      ref={view}
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
 * The side menu, as the web's: the search, Continue watching and every library, then the
 * pinned libraries under their heading, each with its icon, and at the foot Settings, the theme and the toggle
 * that pins the menu open, kept on this device. It is folded to its icons until the remote moves into it, when it opens over
 * the page, labels and all, and folds again as the remote leaves; pinned, it stays open beside
 * the page. It is the left column of Home on a TV, the remote's way to every library, drawn over
 * the page: the page keeps `useSideMenuRoom` for it.
 */
export const SideMenu = ({ libraries, onSearch, onSettings, onOpenLibrary }: SideMenuProps) => {
  const isOpen = useSideMenu(isMenuOpen)
  const isPinned = useSideMenu((menu) => menu.isPinned)
  const toggle = useSideMenu((menu) => menu.toggle)
  const router = useRouter()
  const styles = useStyles()
  return (
    <ScrollView
      contentContainerStyle={styles.content}
      style={[styles.menu, !isOpen && styles.folded]}
    >
      <MenuRow icon="search" label={SEARCH_EVERY_LIBRARY.text} onPress={onSearch} />
      <OpenerRow
        icon="continue"
        label={CONTINUE_WATCHING}
        onPress={() => router.push(APP_ROUTES.continueWatching)}
        place={MENU_PLACES.continueWatching}
      />
      <OpenerRow
        icon="libraries"
        label={LIBRARIES_ENTRY.label}
        onPress={() => router.push(APP_ROUTES.libraries)}
        place={MENU_PLACES.libraries}
      />
      {libraries.length > 0 && isOpen && (
        <Text variant={TEXT_VARIANTS.display} accessibilityRole="header" style={styles.heading}>
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
      <OpenerRow
        icon="settings"
        label={SETTINGS_ENTRY.label}
        onPress={onSettings}
        place={MENU_PLACES.settings}
      />
      <ThemeChoice />
      <MenuRow icon="sidebar" label={isPinned ? MENU_FOOT.unpin : MENU_FOOT.pin} onPress={toggle} />
    </ScrollView>
  )
}

const useStyles = themedStyles((colours) =>
  StyleSheet.create({
    // Over the page's left edge, which keeps `useSideMenuRoom` free for it.
    menu: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      left: 0,
      zIndex: 1,
      elevation: 1,
      width: OPEN_WIDTH,
      backgroundColor: colours.raised,
    },
    folded: { width: FOLDED_WIDTH },
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
    focused: { ...FOCUS_FRONT, borderColor: colours.text, backgroundColor: colours.quiet },
    label: { flexShrink: 1, color: colours.text, fontSize: TV_SIZES.textLg, fontWeight: '600' },
  }),
)
