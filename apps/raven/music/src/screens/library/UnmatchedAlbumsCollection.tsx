import { plural } from '@raven/core'
import { COUNTS_COPY, LIBRARY_PAGE_COPY } from '@raven/wren'
import { FlatList } from 'react-native'

import { useCovers } from '@/music/useCovers'
import { CollectionHeader } from '@/screens/library/CollectionHeader'
import type { CollectionPageProps } from '@/screens/library/CollectionPage'
import { useUnmatchedAlbums } from '@/screens/library/listings'
import { LIST_SHAPES } from '@/components/ListSkeleton'
import { ListNotice } from '@/screens/library/ListNotice'
import { usePageInsets } from '@/shell/useShell'
import { type WrenTheme, themedStyles } from '@/theme/wrenTheme'
import { SPACE } from '@/theme/wrenTokens'
import { AlbumTileOf } from '@/ui/AlbumTile'
import { GRID_GAP, useGrid } from '@/ui/TileGrid'

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  ground: { backgroundColor: colors.bg, flex: 1 },
  content: { gap: SPACE.s5 },
  columns: { gap: GRID_GAP },
}))

/**
 * Unmatched albums: every music library's albums no MusicBrainz release was found for, by
 * title, as raven's tab of the name lists them, in a grid of covers.
 */
export function UnmatchedAlbumsCollection({ session, onBack }: CollectionPageProps) {
  const styles = useStyles()
  const insets = usePageInsets()
  const { coverOf } = useCovers(session)
  const { columns, tileWidth, onLayout } = useGrid()
  const { albums, listing } = useUnmatchedAlbums(session)
  const isCounted = listing.isRead && albums.length > 0
  return (
    <FlatList
      ListEmptyComponent={
        <ListNotice
          empty={LIBRARY_PAGE_COPY.noUnmatchedAlbums}
          listing={listing}
          shape={LIST_SHAPES.tiles}
        />
      }
      ListHeaderComponent={
        <CollectionHeader
          count={isCounted ? plural({ n: albums.length, ...COUNTS_COPY.albums }) : null}
          onBack={onBack}
          title={LIBRARY_PAGE_COPY.unmatchedAlbums}
        />
      }
      // React Native refuses a row's style on a list of one column.
      columnWrapperStyle={columns > 1 && styles.columns}
      contentContainerStyle={[insets, styles.content]}
      data={albums}
      key={columns}
      keyExtractor={(album) => String(album.id)}
      numColumns={columns}
      onLayout={onLayout}
      renderItem={({ item }) => <AlbumTileOf album={item} coverOf={coverOf} width={tileWidth} />}
      style={styles.ground}
    />
  )
}
