import { plural } from '@raven/core'
import { useSearch } from '@raven/ui/headless'
import { useState } from 'react'
import { FlatList } from 'react-native'

import { useCovers } from '@/music/useCovers'
import { LIBRARY_PAGE_COPY } from '@/screens/copy'
import { AlbumTileOf } from '@/ui/AlbumTile'
import { CollectionHeader } from '@/screens/library/CollectionHeader'
import type { CollectionPageProps } from '@/screens/library/CollectionPage'
import { GRID_GAP, useGrid } from '@/ui/TileGrid'
import { useAllAlbums } from '@/screens/library/listings'
import { ListNotice } from '@/screens/library/ListNotice'
import { LIST_SORTS, type ListSort, matchingAlbums, sortedAlbums } from '@/screens/library/sorts'
import { usePageInsets } from '@/shell/useShell'
import { type WrenTheme, themedStyles } from '@/theme/wrenTheme'
import { SPACE } from '@/theme/wrenTokens'
import { COUNTS_COPY } from '@/ui/copy'

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
  const search = useSearch()
  const [sort, setSort] = useState<ListSort>(LIST_SORTS.title)
  const { columns, tileWidth, onLayout } = useGrid()
  const { albums, listing } = useAllAlbums({ session, search: '' })
  const shown = sortedAlbums({ albums: matchingAlbums({ albums, query: search.query }), sort })
  const count = listing.isRead ? plural({ n: shown.length, ...COUNTS_COPY.albums }) : null
  return (
    <FlatList
      ListEmptyComponent={
        <ListNotice
          empty={search.query === '' ? LIBRARY_PAGE_COPY.noAlbums : LIBRARY_PAGE_COPY.noMatches}
          listing={listing}
        />
      }
      ListHeaderComponent={
        <CollectionHeader
          count={count}
          onBack={onBack}
          search={{
            value: search.text,
            onChangeText: search.setText,
            placeholder: LIBRARY_PAGE_COPY.searchAlbums,
          }}
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
