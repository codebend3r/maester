import { WREN_ICONS, type WrenIconName } from '@raven/wren'
import {
  ART,
  LIBRARY_SEGMENTS,
  type LibrarySegment,
  type RecentSearch,
  SEARCH_COPY,
  recentKeyOf,
  recentTextOf,
} from '@raven/wren'
import { router } from 'expo-router'
import { ScrollView, Text, View } from 'react-native'
import { useOpenRecent, useRecentSearches } from '@raven/wren-native'
import { libraryHref } from '@raven/wren-native/headless'

import { RADIUS, SIZE, SPACE, TYPE } from '@/theme/tvTokens'
import { themedStyles } from '@/theme/wrenTheme'
import { FOCUS_ROLES, Focusable } from '@/ui/Focusable'
import { FocusButton } from '@/ui/FocusButton'
import { SectionHeader } from '@/ui/Headers'
import { ListRow } from '@/ui/ListRow'
import { usePageStyles } from '@/ui/pageStyles'
import { WrenIcon } from '@/ui/WrenIcon'

const useStyles = themedStyles(() => ({
  scroller: { flex: 1 },
  idle: { gap: SPACE.s8, paddingBottom: SPACE.gutter },
  tiles: { flexDirection: 'row', gap: SPACE.s4 },
  tile: {
    borderRadius: RADIUS.card,
    height: SIZE.tileSmall,
    justifyContent: 'space-between',
    padding: SPACE.s4,
    width: SIZE.tileLarge,
  },
  tileLabel: TYPE.section,
  recent: { alignItems: 'center', flexDirection: 'row', gap: SPACE.s2 },
  recentRow: { flex: 1 },
}))

/** A Browse tile: the list it opens, and the art colours it wears. */
type BrowseTile = {
  segment: LibrarySegment
  label: string
  icon: WrenIconName
  ground: string
  ink: string
}

/** Albums, Artists and Songs, as the web's Browse: a TV keeps no downloads, so no Downloaded. */
const BROWSE_TILES = [
  {
    segment: LIBRARY_SEGMENTS.albums,
    label: SEARCH_COPY.albums,
    icon: WREN_ICONS.album,
    ground: ART.ink,
    ink: ART.ochre,
  },
  {
    segment: LIBRARY_SEGMENTS.artists,
    label: SEARCH_COPY.artists,
    icon: WREN_ICONS.artist,
    ground: ART.dusk,
    ink: ART.blush,
  },
  {
    segment: LIBRARY_SEGMENTS.songs,
    label: SEARCH_COPY.songs,
    icon: WREN_ICONS.song,
    ground: ART.slate,
    ink: ART.cream,
  },
] as const satisfies readonly BrowseTile[]

/** Albums, Artists and Songs, each opening Library's list of them. */
function Browse() {
  const page = usePageStyles()
  const styles = useStyles()
  return (
    <View style={page.section}>
      <SectionHeader title={SEARCH_COPY.browse} />
      <View style={styles.tiles}>
        {BROWSE_TILES.map((tile) => (
          <Focusable
            key={tile.segment}
            label={tile.label}
            onPress={() => router.push(libraryHref(tile.segment))}
            role={FOCUS_ROLES.link}
            style={[styles.tile, { backgroundColor: tile.ground }]}
          >
            <WrenIcon color={tile.ink} name={tile.icon} size={SIZE.button} />
            <Text numberOfLines={1} style={[styles.tileLabel, { color: tile.ink }]}>
              {tile.label}
            </Text>
          </Focusable>
        ))}
      </View>
    </View>
  )
}

type RecentRowProps = { recent: RecentSearch; onSearch: (text: string) => void }

/** A recent search: a press searches again or opens its page, and its Remove forgets it. */
function RecentRow({ recent, onSearch }: RecentRowProps) {
  const styles = useStyles()
  const forget = useRecentSearches((state) => state.forget)
  const { name, line } = recentTextOf(recent)
  const openRecent = useOpenRecent({ onSearch })
  const open = () => openRecent(recent)
  return (
    <View style={styles.recent}>
      <View style={styles.recentRow}>
        <ListRow icon={WREN_ICONS.recent} line={line} onPress={open} title={name} />
      </View>
      <FocusButton
        icon={WREN_ICONS.close}
        label={SEARCH_COPY.removeRecent(name)}
        onPress={() => forget(recentKeyOf(recent))}
      />
    </View>
  )
}

type SearchIdleProps = { onSearch: (text: string) => void }

/** The searches made here lately, newest first, with Clear; nothing while there are none. */
function RecentList({ onSearch }: SearchIdleProps) {
  const page = usePageStyles()
  const recents = useRecentSearches((state) => state.recents)
  const clear = useRecentSearches((state) => state.clear)
  return (
    recents.length > 0 && (
      <View style={page.section}>
        <SectionHeader
          action={{
            text: SEARCH_COPY.clearRecent,
            label: SEARCH_COPY.clearRecentLabel,
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

/** Search before anything is typed: the Browse tiles and the recent searches. */
export function SearchIdle({ onSearch }: SearchIdleProps) {
  const styles = useStyles()
  return (
    <ScrollView contentContainerStyle={styles.idle} style={styles.scroller}>
      <Browse />
      <RecentList onSearch={onSearch} />
    </ScrollView>
  )
}
