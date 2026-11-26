import { LIBRARY_PAGE_COPY, RECENT_SORTS } from '@raven/wren'
import { router } from 'expo-router'
import { ScrollView, View } from 'react-native'

import { ListNotice } from '@/components/ListNotice'
import {
  useCovers,
  type WrenSession,
  useWren,
  useLibraryValues,
  useRecentAlbums,
} from '@raven/wren-native'
import { libraryHref } from '@raven/wren-native/headless'
import { AlbumTileOf } from '@/components/AlbumTileOf'
import { CATEGORIES } from '@/screens/library/categories'
import { CONTENT_WIDTH } from '@/shell/layout'
import { SIZE, SPACE } from '@/theme/tvTokens'
import { columnsFitting } from '@/ui/grid'
import { PageHeader, SectionHeader } from '@/ui/Headers'
import { ListRow } from '@/ui/ListRow'
import { TileGrid } from '@/ui/TileGrid'
import { usePageStyles } from '@/ui/pageStyles'
import { themedStyles } from '@/theme/wrenTheme'

const useStyles = themedStyles(() => ({ content: { gap: SPACE.s4, padding: SPACE.gutter } }))

/** How many of the newest albums Library shows: two rows, as the tablet's grid does. */
const RECENT_SHOWN = 2 * columnsFitting({ width: CONTENT_WIDTH, tile: SIZE.tile, gap: SPACE.s4 })

type LibraryPageProps = { session: WrenSession }

/** The newest albums of every music library, as a grid. */
function RecentGrid({ session }: LibraryPageProps) {
  const page = usePageStyles()
  const { coverOf } = useCovers(session)
  const { albums, listing } = useRecentAlbums({
    session,
    sort: RECENT_SORTS.added,
    limit: RECENT_SHOWN,
  })
  return (
    <View style={page.section}>
      <SectionHeader title={LIBRARY_PAGE_COPY.recent} />
      {albums.length === 0 && <ListNotice empty={LIBRARY_PAGE_COPY.noAlbums} listing={listing} />}
      <TileGrid
        items={albums}
        keyOf={(album) => album.id}
        renderTile={(album) => <AlbumTileOf album={album} coverOf={coverOf} width={SIZE.tile} />}
      />
    </View>
  )
}

function LibraryPage({ session }: LibraryPageProps) {
  const styles = useStyles()
  const page = usePageStyles()
  // What each category holds, summed over every music library; one not known yet is left out.
  const values = useLibraryValues(session)
  return (
    <ScrollView contentContainerStyle={styles.content} style={page.ground}>
      <PageHeader title={LIBRARY_PAGE_COPY.title} />
      <View>
        {CATEGORIES.map((category, at) => (
          <ListRow
            hasPreferredFocus={at === 0}
            icon={category.icon}
            key={category.kind}
            onPress={() => router.push(libraryHref(category.kind))}
            canOpen
            title={category.label}
            value={values[category.kind] ?? null}
          />
        ))}
      </View>
      <RecentGrid session={session} />
    </ScrollView>
  )
}

/**
 * Library: its categories, each a page of its own with what it holds beside it, and the newest
 * albums of every music library under them.
 */
export function Library() {
  const session = useWren()
  return session !== null && <LibraryPage session={session} />
}
