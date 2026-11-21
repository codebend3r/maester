import { formatBytes } from '@raven/core'
import {
  countsLineOf,
  countValueOf,
  factsLineOf,
  LIBRARY_PAGE_COPY,
  LIBRARY_SEGMENTS,
  type LibrarySegment,
  RECENT_SORTS,
} from '@raven/wren'
import { useRouter } from 'expo-router'
import { ScrollView, View } from 'react-native'

import { useCovers } from '@/music/useCovers'
import {
  useDownloadsSummary,
  usePlaylists,
  useRecentAlbums,
  useSongCount,
} from '@/screens/library/listings'
import { ListNotice } from '@/screens/library/ListNotice'
import { WREN_ROUTES, libraryHref } from '@/routes'
import { usePageInsets } from '@/shell/useShell'
import { type WrenTheme, themedStyles, useFormFactor, useWrenTheme } from '@/theme/wrenTheme'
import { SIZE, SPACE, FORM_FACTORS, type FormFactor } from '@/theme/wrenTokens'
import { AlbumTileOf } from '@/ui/AlbumTile'
import { IconButton } from '@/ui/IconButton'
import { NAVIGATION_ROW_VARIANTS, NavigationRow } from '@/ui/NavigationRow'
import { PageHeader } from '@/ui/PageHeader'
import { SectionHeader } from '@/ui/SectionHeader'
import { TileGrid } from '@/ui/TileGrid'
import { ICONS, type WrenIconName } from '@/ui/WrenIcon'
import { type WrenSession, useWren } from '@/useWren'

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

type Category = { kind: LibrarySegment; label: string; icon: WrenIconName }

/** Each category's row: its icon and its name, in the order Library lists them. */
const CATEGORIES = [
  { kind: LIBRARY_SEGMENTS.playlists, label: LIBRARY_PAGE_COPY.playlists, icon: ICONS.playlist },
  { kind: LIBRARY_SEGMENTS.artists, label: LIBRARY_PAGE_COPY.artists, icon: ICONS.artist },
  { kind: LIBRARY_SEGMENTS.albums, label: LIBRARY_PAGE_COPY.albums, icon: ICONS.album },
  { kind: LIBRARY_SEGMENTS.songs, label: LIBRARY_PAGE_COPY.songs, icon: ICONS.song },
  { kind: LIBRARY_SEGMENTS.downloads, label: LIBRARY_PAGE_COPY.downloads, icon: ICONS.downloads },
] as const satisfies readonly Category[]

type CategoryValuesProps = { session: WrenSession }

/**
 * What each category holds, beside its row, where it costs next to nothing to know: the
 * playlists, the songs (each library's total, from a page of one track) and the downloads. The
 * server counts no albums or artists short of listing them all, so those rows hold no count, and
 * a count still on its way, or one that failed, is left out rather than guessed.
 */
const useCategoryValues = ({
  session,
}: CategoryValuesProps): Record<LibrarySegment, string | undefined> => {
  const songs = useSongCount({ session, search: '' })
  const playlists = usePlaylists(session)
  const downloads = useDownloadsSummary(session.server.id)
  const downloaded = countsLineOf({ albums: downloads.albums, playlists: downloads.playlists })
  return {
    [LIBRARY_SEGMENTS.playlists]: countValueOf({
      n: playlists.data?.length ?? null,
      none: LIBRARY_PAGE_COPY.noneYet,
    }),
    [LIBRARY_SEGMENTS.artists]: undefined,
    [LIBRARY_SEGMENTS.albums]: undefined,
    [LIBRARY_SEGMENTS.songs]: countValueOf({ n: songs }),
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
      {albums.length === 0 && <ListNotice empty={LIBRARY_PAGE_COPY.noAlbums} listing={listing} />}
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
