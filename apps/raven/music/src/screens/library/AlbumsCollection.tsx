import { plural } from '@raven/core'
import {
  COUNTS_COPY,
  LIBRARY_PAGE_COPY,
  LIST_SORTS,
  type ListSort,
  matchingAlbums,
  sortedAlbums,
} from '@raven/wren'
import { useState } from 'react'
import { FlatList } from 'react-native'

import { useCovers } from '@/music/useCovers'
import { AlbumTileOf } from '@/ui/AlbumTile'
import { CollectionHeader } from '@/screens/library/CollectionHeader'
import type { CollectionPageProps } from '@/screens/library/CollectionPage'
import { GRID_GAP, useGrid } from '@/ui/TileGrid'
import { useAllAlbums } from '@/screens/library/listings'
import { ListNotice } from '@/screens/library/ListNotice'
import { useCollectionSearch } from '@/screens/library/useCollectionSearch'
import { usePageInsets } from '@/shell/useShell'
import { type WrenTheme, themedStyles } from '@/theme/wrenTheme'
import { SPACE } from '@/theme/wrenTokens'

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  ground: { backgroundColor: colors.bg, flex: 1 },
  content: { gap: SPACE.s5 },
  columns: { gap: GRID_GAP },
}))

/**
 * Albums: every music library's, found by what is typed and put in the order picked, both on
 * the device, as a grid of two columns on a phone and five on a tablet.
 */
export function AlbumsCollection({ session, onBack }: CollectionPageProps) {
  const styles = useStyles()
  const insets = usePageInsets()
  const { coverOf } = useCovers(session)
  const search = useCollectionSearch({
    placeholder: LIBRARY_PAGE_COPY.searchAlbums,
    none: LIBRARY_PAGE_COPY.noAlbums,
  })
  const [sort, setSort] = useState<ListSort>(LIST_SORTS.title)
  const { columns, tileWidth, onLayout } = useGrid()
  const { albums, listing } = useAllAlbums({ session, search: '' })
  const shown = sortedAlbums({ albums: matchingAlbums({ albums, query: search.query }), sort })
  const count = listing.isRead ? plural({ n: shown.length, ...COUNTS_COPY.albums }) : null
  return (
    <FlatList
      ListEmptyComponent={<ListNotice empty={search.empty} listing={listing} />}
      ListHeaderComponent={
        <CollectionHeader
          count={count}
          onBack={onBack}
          search={search.field}
          sort={{ sort, onSort: setSort }}
          title={LIBRARY_PAGE_COPY.albums}
        />
      }
      columnWrapperStyle={styles.columns}
      contentContainerStyle={[insets, styles.content]}
      data={shown}
      key={columns}
      keyExtractor={(album) => String(album.id)}
      keyboardDismissMode="on-drag"
      numColumns={columns}
      onLayout={onLayout}
      renderItem={({ item }) => <AlbumTileOf album={item} coverOf={coverOf} width={tileWidth} />}
      style={styles.ground}
    />
  )
}
