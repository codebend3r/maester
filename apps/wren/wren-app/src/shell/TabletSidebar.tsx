import { HOME_COPY, LIBRARY_PAGE_COPY, SEARCH_COPY, SETTINGS_COPY } from '@raven/wren'
import { type Href, usePathname, useRouter } from 'expo-router'
import type { ComponentType } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { wrenVersion } from '@/about/version'
import { WrenLockup, WrenMark } from '@/components/WrenLockup'
import { WREN_ROUTES, collectionPathOf, libraryHref } from '@/routes'
import { CATEGORIES, type Category } from '@/screens/library/categories'
import { type WrenTheme, themedStyles, useIsPortrait, useWrenTheme } from '@/theme/wrenTheme'
import { FONTS, RADIUS, SHELL_SIZES, SIZE, SPACE, TYPE } from '@/theme/wrenTokens'
import { pressedStyleOf } from '@/ui/press'
import { ServerStatusChip } from '@/ui/ServerStatusChip'
import { Unseen } from '@/ui/Unseen'
import { ICONS, WrenIcon, type WrenIconName } from '@/ui/WrenIcon'
import { useWren } from '@/useWren'

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  sidebar: {
    backgroundColor: colors.surface,
    borderRightColor: colors.line,
    borderRightWidth: SIZE.hairline,
    flexGrow: 0,
    width: SHELL_SIZES.tabletSidebar,
  },
  rail: { width: SHELL_SIZES.tabletRail },
  // Grown to the sidebar's height, so Settings keeps to its foot until the places outgrow it.
  places: { flexGrow: 1, gap: SPACE.s1, paddingBottom: SPACE.s4, paddingHorizontal: SPACE.s3 },
  // The lockup's height and the room under it, whichever of the lockup or the mark is drawn.
  lockup: {
    justifyContent: 'center',
    minHeight: SIZE.lockup + SPACE.s6,
    paddingBottom: SPACE.s6,
    paddingHorizontal: SPACE.s2,
  },
  // The mark stands over the icons, its centre on theirs.
  railLockup: { paddingHorizontal: SPACE.s3 + (SIZE.navIcon - SIZE.largeIcon) / 2 },
  overline: {
    ...TYPE.overline,
    color: colors.text3,
    paddingHorizontal: SPACE.s3,
    paddingTop: SPACE.s5,
  },
  spacer: { flex: 1 },
  item: {
    alignItems: 'center',
    alignSelf: 'stretch',
    borderRadius: RADIUS.item,
    flexDirection: 'row',
    gap: SIZE.rowGap,
    minHeight: SHELL_SIZES.sidebarItem,
    paddingHorizontal: SPACE.s3,
  },
  active: { backgroundColor: colors.accentSoft },
  label: { ...TYPE.rowTitle, color: colors.text },
  activeLabel: { ...TYPE.rowTitle, color: colors.accentText, fontFamily: FONTS.bodySemiBold },
  version: {
    ...TYPE.small,
    color: colors.text3,
    paddingHorizontal: SPACE.s3,
    paddingTop: SPACE.s2,
  },
}))

/** One place the sidebar opens: its name, its drawing, its address and the path it shows at. */
type SidebarPlace = { key: string; label: string; icon: WrenIconName; href: Href; path: string }

type TabPlaceProps = { label: string; icon: WrenIconName; path: string }

const tabPlace = ({ label, icon, path }: TabPlaceProps): SidebarPlace => ({
  key: path,
  label,
  icon,
  href: path,
  path,
})

/** One of Library's categories as a place the sidebar opens. */
const collectionPlace = ({ kind, label, icon }: Category): SidebarPlace => ({
  key: kind,
  label,
  icon,
  href: libraryHref(kind),
  path: collectionPathOf(kind),
})

/** Home and Search, at the sidebar's top. */
const TOP_PLACES = [
  tabPlace({ label: HOME_COPY.title, icon: ICONS.home, path: WREN_ROUTES.home }),
  tabPlace({ label: SEARCH_COPY.title, icon: ICONS.search, path: WREN_ROUTES.search }),
] as const

/** Library's categories, under its overline, in Library's order. */
const LIBRARY_PLACES = CATEGORIES.map(collectionPlace)

const SETTINGS_PLACE = tabPlace({
  label: SETTINGS_COPY.title,
  icon: ICONS.settings,
  path: WREN_ROUTES.settings,
})

const LOGO_VIEWS = { lockup: 'lockup', mark: 'mark' } as const

type LogoView = (typeof LOGO_VIEWS)[keyof typeof LOGO_VIEWS]

const SidebarMark = () => <WrenMark size={SIZE.largeIcon} />

const SidebarLockup = () => <WrenLockup size={SIZE.lockup} />

/** The lockup on the open sidebar, the bird alone on the rail, as the web's sidebar draws them. */
const LOGOS = {
  [LOGO_VIEWS.lockup]: SidebarLockup,
  [LOGO_VIEWS.mark]: SidebarMark,
} as const satisfies Record<LogoView, ComponentType>

type SidebarItemProps = { place: SidebarPlace; isRail: boolean }

/** One of the sidebar's places, bright on a soft red ground while it is the page showing. */
function SidebarItem({ place, isRail }: SidebarItemProps) {
  const styles = useStyles()
  const { colors } = useWrenTheme()
  const router = useRouter()
  const isActive = usePathname() === place.path
  return (
    <Pressable
      accessibilityLabel={place.label}
      accessibilityRole="link"
      accessibilityState={{ selected: isActive }}
      onPress={() => router.navigate(place.href)}
      style={pressedStyleOf({
        style: [styles.item, isActive && styles.active],
      })}
    >
      <WrenIcon
        color={isActive ? colors.accentText : colors.text2}
        name={place.icon}
        size={SIZE.navIcon}
      />
      {!isRail && <Text style={isActive ? styles.activeLabel : styles.label}>{place.label}</Text>}
    </Pressable>
  )
}

/**
 * The tablet's sidebar: the lockup, Home and Search, Library's categories, then Settings, the
 * server's status and Wren's version at its foot, as the web's sidebar has them. Held upright,
 * it folds to a rail: the same places with only their words gone, the bird over them, every
 * icon where the open sidebar has it, each still named for a screen reader.
 */
export function TabletSidebar() {
  const styles = useStyles()
  const isRail = useIsPortrait()
  const Logo = LOGOS[isRail ? LOGO_VIEWS.mark : LOGO_VIEWS.lockup]
  const session = useWren()
  const { top } = useSafeAreaInsets()
  return (
    <ScrollView
      contentContainerStyle={[styles.places, { paddingTop: top + SPACE.s4 }]}
      showsVerticalScrollIndicator={false}
      style={[styles.sidebar, isRail && styles.rail]}
    >
      <View style={[styles.lockup, isRail && styles.railLockup]}>
        <Logo />
      </View>
      {TOP_PLACES.map((place) => (
        <SidebarItem isRail={isRail} key={place.key} place={place} />
      ))}
      {/* On the rail the overline and the status keep their room, only unseen, so no row moves. */}
      <Unseen isUnseen={isRail}>
        <Text accessibilityRole="header" style={styles.overline}>
          {LIBRARY_PAGE_COPY.title}
        </Text>
      </Unseen>
      {LIBRARY_PLACES.map((place) => (
        <SidebarItem isRail={isRail} key={place.key} place={place} />
      ))}
      <View style={styles.spacer} />
      <SidebarItem isRail={isRail} place={SETTINGS_PLACE} />
      {session !== null && (
        <Unseen isUnseen={isRail}>
          <ServerStatusChip session={session} />
        </Unseen>
      )}
      <Unseen isUnseen={isRail}>
        <Text style={styles.version}>{SETTINGS_COPY.versionOf(wrenVersion)}</Text>
      </Unseen>
    </ScrollView>
  )
}
