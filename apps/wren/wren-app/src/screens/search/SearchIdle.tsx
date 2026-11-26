import {
  KIT_COPY,
  LIBRARY_SEGMENTS,
  type LibrarySegment,
  RECENT_KINDS,
  recentKeyOf,
  type RecentSearch,
  recentTextOf,
  SEARCH_COPY,
  ART,
} from '@raven/wren'
import { useRouter } from 'expo-router'
import { Pressable, Text, View } from 'react-native'

import { useRecentSearches } from '@raven/wren-native'
import { WREN_PAGES, libraryHref, pageHref } from '@raven/wren-native/headless'
import { type WrenTheme, themedStyles, useFormFactor, useWrenTheme } from '@/theme/wrenTheme'
import {
  RADIUS,
  SEARCH_SIZES,
  SIZE,
  SPACE,
  TYPE,
  FORM_FACTORS,
  type FormFactor,
} from '@/theme/wrenTokens'
import { IconButton } from '@/ui/IconButton'
import { pressedStyleOf } from '@/ui/press'
import { SectionHeader } from '@/ui/SectionHeader'
import { tileWidthOf } from '@/ui/tileWidth'
import { ICONS, WrenIcon, type WrenIconName } from '@/ui/WrenIcon'

// Two Browse tiles to a row on a phone, all four in one on a tablet.
const BROWSE_COLUMNS = {
  [FORM_FACTORS.phone]: 2,
  [FORM_FACTORS.tablet]: 4,
} as const satisfies Record<FormFactor, number>

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  idle: { gap: SPACE.s8 },
  section: { gap: SPACE.s3 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.s3 },
  tile: {
    borderRadius: RADIUS.lg,
    height: SEARCH_SIZES.browseTile,
    justifyContent: 'space-between',
    padding: SPACE.s3,
  },
  tileLabel: TYPE.rowStrong,
  recent: {
    alignItems: 'center',
    borderBottomColor: colors.line,
    borderBottomWidth: SIZE.hairline,
    flexDirection: 'row',
    gap: SIZE.rowGap,
    minHeight: SIZE.navRow,
  },
  recentMain: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: SIZE.rowGap },
  recentText: { flex: 1 },
  recentName: { ...TYPE.rowTitle, color: colors.text },
  recentLine: { ...TYPE.meta, color: colors.text2 },
}))

/** A Browse tile: the list it opens, and the art colours it wears. */
type BrowseTile = {
  segment: LibrarySegment
  label: string
  icon: WrenIconName
  ground: string
  ink: string
}

const BROWSE_TILES = [
  {
    segment: LIBRARY_SEGMENTS.albums,
    label: SEARCH_COPY.albums,
    icon: ICONS.album,
    ground: ART.ink,
    ink: ART.ochre,
  },
  {
    segment: LIBRARY_SEGMENTS.artists,
    label: SEARCH_COPY.artists,
    icon: ICONS.artist,
    ground: ART.dusk,
    ink: ART.blush,
  },
  {
    segment: LIBRARY_SEGMENTS.songs,
    label: SEARCH_COPY.songs,
    icon: ICONS.song,
    ground: ART.slate,
    ink: ART.cream,
  },
  {
    segment: LIBRARY_SEGMENTS.downloads,
    label: SEARCH_COPY.downloaded,
    icon: ICONS.downloads,
    ground: ART.pine,
    ink: ART.sand,
  },
] as const satisfies readonly BrowseTile[]

type BrowseProps = { width: number }

/** Albums, Artists, Songs and Downloaded, each opening Library's list of them. */
function Browse({ width }: BrowseProps) {
  const styles = useStyles()
  const router = useRouter()
  const columns = BROWSE_COLUMNS[useFormFactor()]
  const tileWidth = tileWidthOf({ width, columns, gap: SPACE.s3 })
  return (
    <View style={styles.section}>
      <SectionHeader title={SEARCH_COPY.browse} />
      <View style={styles.tiles}>
        {BROWSE_TILES.map((tile) => (
          <Pressable
            accessibilityLabel={tile.label}
            accessibilityRole="link"
            key={tile.segment}
            onPress={() => router.push(libraryHref(tile.segment))}
            style={pressedStyleOf({
              style: [styles.tile, { backgroundColor: tile.ground, width: tileWidth }],
            })}
          >
            <WrenIcon color={tile.ink} name={tile.icon} size={SIZE.largeIcon} />
            <Text numberOfLines={1} style={[styles.tileLabel, { color: tile.ink }]}>
              {tile.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  )
}

type RecentViewProps = { recent: RecentSearch }

type RecentRowProps = RecentViewProps & { onSearch: (text: string) => void }

/** A recent search: a press searches again or opens its page, and its x forgets it. */
function RecentRow({ recent, onSearch }: RecentRowProps) {
  const styles = useStyles()
  const router = useRouter()
  const { colors } = useWrenTheme()
  const remember = useRecentSearches((state) => state.remember)
  const forget = useRecentSearches((state) => state.forget)
  const { name, line } = recentTextOf(recent)
  const open = () => {
    remember(recent)
    switch (recent.kind) {
      case RECENT_KINDS.query:
        onSearch(recent.text)
        return
      case RECENT_KINDS.artist:
        router.push(pageHref({ page: WREN_PAGES.artist, id: recent.id }))
        return
      case RECENT_KINDS.album:
        router.push(pageHref({ page: WREN_PAGES.album, id: recent.id }))
        return
      default: {
        const unknownKind: never = recent
        return unknownKind
      }
    }
  }
  return (
    <View style={styles.recent}>
      <Pressable
        accessibilityLabel={KIT_COPY.labelled({ label: name, value: line })}
        accessibilityRole="button"
        onPress={open}
        style={pressedStyleOf({ style: styles.recentMain })}
      >
        <WrenIcon color={colors.text3} name={ICONS.recent} size={SIZE.icon} />
        <View style={styles.recentText}>
          <Text numberOfLines={1} style={styles.recentName}>
            {name}
          </Text>
          <Text numberOfLines={1} style={styles.recentLine}>
            {line}
          </Text>
        </View>
      </Pressable>
      <IconButton
        color={colors.text3}
        icon={ICONS.close}
        label={SEARCH_COPY.removeRecent(name)}
        onPress={() => forget(recentKeyOf(recent))}
        size={SIZE.smallButton}
      />
    </View>
  )
}

type RecentListProps = { onSearch: (text: string) => void }

/** The searches made here lately, newest first, with Clear; nothing while there are none. */
function RecentList({ onSearch }: RecentListProps) {
  const recents = useRecentSearches((state) => state.recents)
  const clear = useRecentSearches((state) => state.clear)
  return (
    recents.length > 0 && (
      <View>
        <SectionHeader
          action={{
            label: SEARCH_COPY.clearRecent,
            spoken: SEARCH_COPY.clearRecentLabel,
            onPress: clear,
          }}
          title={SEARCH_COPY.recent}
        />
        {recents.map((recent) => (
          <RecentRow key={recentKeyOf(recent)} onSearch={onSearch} recent={recent} />
        ))}
      </View>
    )
  )
}

type SearchIdleProps = {
  /** The width inside the page's padding, which the Browse tiles share. */
  width: number
  onSearch: (text: string) => void
}

/** Search before anything is typed: the Browse tiles and the recent searches. */
export function SearchIdle({ width, onSearch }: SearchIdleProps) {
  const styles = useStyles()
  return (
    <View style={styles.idle}>
      <Browse width={width} />
      <RecentList onSearch={onSearch} />
    </View>
  )
}
