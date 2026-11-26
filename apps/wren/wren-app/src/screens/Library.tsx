import { formatBytes } from '@raven/core'
import {
  countsLineOf,
  factsLineOf,
  LIBRARY_PAGE_COPY,
  LIBRARY_SEGMENTS,
  type LibrarySegment,
  RECENT_SORTS,
} from '@raven/wren'
import { useRouter } from 'expo-router'
import { ScrollView, View } from 'react-native'

import {
  useCovers,
  type WrenSession,
  useWren,
  useLibraryValues,
  useRecentAlbums,
} from '@raven/wren-native'
import { useDownloadsSummary } from '@/screens/library/downloadsSummary'
import { WREN_ROUTES, libraryHref } from '@raven/wren-native/headless'
import { CATEGORIES } from '@/screens/library/categories'
import { LIST_SHAPES } from '@/components/ListSkeleton'
import { ListNotice } from '@/screens/library/ListNotice'
import { usePageInsets } from '@/shell/useShell'
import { type WrenTheme, themedStyles, useFormFactor, useWrenTheme } from '@/theme/wrenTheme'
import { SIZE, SPACE, FORM_FACTORS, type FormFactor } from '@/theme/wrenTokens'
import { AlbumTileOf } from '@/ui/AlbumTile'
import { IconButton } from '@/ui/IconButton'
import { NAVIGATION_ROW_VARIANTS, NavigationRow } from '@/ui/NavigationRow'
import { PageHeader } from '@/ui/PageHeader'
import { SectionHeader } from '@/ui/SectionHeader'
import { TileGrid } from '@/ui/TileGrid'
import { ICONS } from '@/ui/WrenIcon'

/** How many of the newest albums Library's grid shows: three rows on a phone, two on a tablet. */
const RECENT_SHOWN = {
  [FORM_FACTORS.phone]: 6,
  [FORM_FACTORS.tablet]: 10,
} as const satisfies Record<FormFactor, number>

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  ground: { backgroundColor: colors.bg, flex: 1 },
  content: { gap: SPACE.s6 },
  rows: { gap: 0 },
  row: { borderBottomColor: colors.line, borderBottomWidth: SIZE.hairline },
  section: { gap: SPACE.s3 },
}))

type CategoryValuesProps = { session: WrenSession }

/*
 * What each category holds, beside its row: the server's counts summed over every music library
 * (the albums, the artists, the unmatched albums, what is in progress, the favourites and what
 * was finished), the playlists, each library's total of songs, and the downloads. A count still
 * on its way, one that failed and a zero are left out rather than guessed.
 */
const useCategoryValues = ({
  session,
}: CategoryValuesProps): Record<LibrarySegment, string | undefined> => {
  const shared = useLibraryValues(session)
  const downloads = useDownloadsSummary(session.server.id)
  const downloaded = countsLineOf({ albums: downloads.albums, playlists: downloads.playlists })
  return {
    ...shared,
    [LIBRARY_SEGMENTS.downloads]:
      downloaded === ''
        ? LIBRARY_PAGE_COPY.noneYet
        : factsLineOf([downloaded, formatBytes(downloads.bytes)]),
  }
}

type LibraryPageProps = { session: WrenSession }

/** The newest albums of every music library, as a grid. */
function RecentGrid({ session }: LibraryPageProps) {
  const styles = useStyles()
  const { coverOf } = useCovers(session)
  const { albums, listing } = useRecentAlbums({
    session,
    sort: RECENT_SORTS.added,
    limit: RECENT_SHOWN[useFormFactor()],
  })
  return (
    <View style={styles.section}>
      <SectionHeader title={LIBRARY_PAGE_COPY.recent} />
      {albums.length === 0 && (
        <ListNotice
          empty={LIBRARY_PAGE_COPY.noAlbums}
          listing={listing}
          shape={LIST_SHAPES.tiles}
        />
      )}
      <TileGrid
        items={albums}
        keyOf={(album) => album.id}
        renderTile={({ item, width }) => (
          <AlbumTileOf album={item} coverOf={coverOf} width={width} />
        )}
      />
    </View>
  )
}

function LibraryPage({ session }: LibraryPageProps) {
  const styles = useStyles()
  const router = useRouter()
  const { colors } = useWrenTheme()
  const insets = usePageInsets()
  const values = useCategoryValues({ session })
  return (
    <ScrollView contentContainerStyle={[insets, styles.content]} style={styles.ground}>
      <PageHeader
        actions={
          <IconButton
            color={colors.text}
            icon={ICONS.search}
            label={LIBRARY_PAGE_COPY.search}
            onPress={() => router.navigate(WREN_ROUTES.search)}
          />
        }
        title={LIBRARY_PAGE_COPY.title}
      />
      <View style={styles.rows}>
        {CATEGORIES.map((category) => (
          <View key={category.kind} style={styles.row}>
            <NavigationRow
              icon={category.icon}
              label={category.label}
              onPress={() => router.push(libraryHref(category.kind))}
              value={values[category.kind]}
              variant={NAVIGATION_ROW_VARIANTS.library}
            />
          </View>
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
