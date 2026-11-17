import { type Href, usePathname, useRouter } from 'expo-router'
import { Pressable, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { WrenLockup } from '@/components/WrenLockup'
import {
  LIBRARY_SEGMENTS,
  type LibrarySegment,
  WREN_ROUTES,
  collectionPathOf,
  libraryHref,
} from '@/routes'
import { HOME_COPY, LIBRARY_PAGE_COPY, SEARCH_COPY, SETTINGS_COPY } from '@/screens/copy'
import { type WrenTheme, themedStyles, useIsPortrait, useWrenTheme } from '@/theme/wrenTheme'
import { FONTS, RADIUS, SHELL_SIZES, SIZE, SPACE, TYPE } from '@/theme/wrenTokens'
import { pressedStyleOf } from '@/ui/press'
import { ServerStatusChip } from '@/ui/ServerStatusChip'
import { ICONS, WrenIcon, type WrenIconName } from '@/ui/WrenIcon'
import { useWren } from '@/useWren'

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  sidebar: {
    backgroundColor: colors.surface,
    borderRightColor: colors.line,
    borderRightWidth: SIZE.hairline,
    gap: SPACE.s1,
    paddingBottom: SPACE.s4,
    paddingHorizontal: SPACE.s3,
    width: SHELL_SIZES.tabletSidebar,
  },
  rail: { alignItems: 'center', paddingHorizontal: SPACE.s3, width: SHELL_SIZES.tabletRail },
  lockup: { paddingBottom: SPACE.s6, paddingHorizontal: SPACE.s2 },
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
  railItem: { justifyContent: 'center', minHeight: SIZE.touchTarget, paddingHorizontal: 0 },
  active: { backgroundColor: colors.accentSoft },
  label: { ...TYPE.rowTitle, color: colors.text },
  activeLabel: { ...TYPE.rowTitle, color: colors.accentText, fontFamily: FONTS.bodySemiBold },
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

type CollectionPlaceProps = { kind: LibrarySegment; label: string; icon: WrenIconName }

const collectionPlace = ({ kind, label, icon }: CollectionPlaceProps): SidebarPlace => ({
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

/** Library's categories, under its overline. */
const LIBRARY_PLACES = [
  collectionPlace({
    kind: LIBRARY_SEGMENTS.playlists,
    label: LIBRARY_PAGE_COPY.playlists,
    icon: ICONS.playlist,
  }),
  collectionPlace({
    kind: LIBRARY_SEGMENTS.artists,
    label: LIBRARY_PAGE_COPY.artists,
    icon: ICONS.artist,
  }),
  collectionPlace({
    kind: LIBRARY_SEGMENTS.albums,
    label: LIBRARY_PAGE_COPY.albums,
    icon: ICONS.album,
  }),
  collectionPlace({
    kind: LIBRARY_SEGMENTS.songs,
    label: LIBRARY_PAGE_COPY.songs,
    icon: ICONS.song,
  }),
  collectionPlace({
    kind: LIBRARY_SEGMENTS.downloads,
    label: LIBRARY_PAGE_COPY.downloads,
    icon: ICONS.downloads,
  }),
] as const

const SETTINGS_PLACE = tabPlace({
  label: SETTINGS_COPY.title,
  icon: ICONS.settings,
  path: WREN_ROUTES.settings,
})

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
        style: [styles.item, isRail && styles.railItem, isActive && styles.active],
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
 * The tablet's sidebar: the lockup, Home and Search, Library's categories, then Settings and
 * the server's status at its foot. Held upright, it folds to a rail of icons, each still named
 * for a screen reader.
 */
export function TabletSidebar() {
  const styles = useStyles()
  const isRail = useIsPortrait()
  const session = useWren()
  const { top } = useSafeAreaInsets()
  return (
    <View style={[styles.sidebar, isRail && styles.rail, { paddingTop: top + SPACE.s4 }]}>
      {!isRail && (
        <View style={styles.lockup}>
          <WrenLockup size={SIZE.lockup} />
        </View>
      )}
      {TOP_PLACES.map((place) => (
        <SidebarItem isRail={isRail} key={place.key} place={place} />
      ))}
      {!isRail && (
        <Text accessibilityRole="header" style={styles.overline}>
          {LIBRARY_PAGE_COPY.title}
        </Text>
      )}
      {LIBRARY_PLACES.map((place) => (
        <SidebarItem isRail={isRail} key={place.key} place={place} />
      ))}
      <View style={styles.spacer} />
      <SidebarItem isRail={isRail} place={SETTINGS_PLACE} />
      {!isRail && session !== null && <ServerStatusChip session={session} />}
    </View>
  )
}
