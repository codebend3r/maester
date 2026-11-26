import { plural } from '@raven/core'
import {
  COUNTS_COPY,
  COVER_SIZES,
  type CoverSize,
  FIRST_LIST_ORDER,
  LIBRARY_PAGE_COPY,
  type ListOrder,
  listOrderOf,
  matchingAlbums,
  sortedAlbums,
} from '@raven/wren'
import { useState } from 'react'
import { FlatList } from 'react-native'

import { useCovers, useAllAlbums, useCollectionSearch } from '@raven/wren-native'
import { AlbumTileOf } from '@/ui/AlbumTile'
import { CollectionHeader } from '@/screens/library/CollectionHeader'
import type { CollectionPageProps } from '@/screens/library/CollectionPage'
import { GRID_GAP, useGrid } from '@/ui/TileGrid'
import { LIST_SHAPES } from '@/components/ListSkeleton'
import { ListNotice } from '@/screens/library/ListNotice'
import { CoverSizeButton } from '@/screens/library/CoverSizeButton'
import { SortButton } from '@/screens/library/SortButton'
import { usePageInsets } from '@/shell/useShell'
import { useWrenPrefs } from '@/stores/wrenPrefs'
import { type WrenTheme, themedStyles } from '@/theme/wrenTheme'
import { SIZE, SPACE } from '@/theme/wrenTokens'

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  ground: { backgroundColor: colors.bg, flex: 1 },
  content: { gap: SPACE.s5 },
  columns: { gap: GRID_GAP },
}))

/** Each cover size's tile width: Albums fits as many columns of it as the width holds. */
const COVER_WIDTHS = {
  [COVER_SIZES.extraSmall]: SIZE.coverExtraSmall,
  [COVER_SIZES.small]: SIZE.coverSmall,
  [COVER_SIZES.medium]: SIZE.coverMedium,
  [COVER_SIZES.large]: SIZE.coverLarge,
  [COVER_SIZES.extraLarge]: SIZE.coverExtraLarge,
} as const satisfies Record<CoverSize, number>

/**
 * Albums: every music library's, found by what is typed and put in the order picked, both on
 * the device, as a grid of as many columns as fit at the cover size kept in the prefs.
 */
export function AlbumsCollection({ session, onBack }: CollectionPageProps) {
  const styles = useStyles()
  const insets = usePageInsets()
  const { coverOf } = useCovers(session)
  const search = useCollectionSearch({
    placeholder: LIBRARY_PAGE_COPY.searchAlbums,
    none: LIBRARY_PAGE_COPY.noAlbums,
  })
  const [order, setOrder] = useState<ListOrder>(FIRST_LIST_ORDER)
  const coverSize = useWrenPrefs((state) => state.coverSize)
  const { columns, tileWidth, onLayout } = useGrid({ tile: COVER_WIDTHS[coverSize] })
  const { albums, listing } = useAllAlbums({ session, search: '' })
  const shown = sortedAlbums({ albums: matchingAlbums({ albums, query: search.query }), order })
  const count = listing.isRead ? plural({ n: shown.length, ...COUNTS_COPY.albums }) : null
  return (
    <FlatList
      ListEmptyComponent={
        <ListNotice empty={search.empty} listing={listing} shape={LIST_SHAPES.tiles} />
      }
      ListHeaderComponent={
        <CollectionHeader
          count={count}
          onBack={onBack}
          search={search.field}
          title={LIBRARY_PAGE_COPY.albums}
          tools={
            <>
              <SortButton onSort={(sort) => setOrder(listOrderOf(sort))} sort={order.sort} />
              <CoverSizeButton />
            </>
          }
        />
      }
      // React Native refuses a row's style on a list of one column.
      columnWrapperStyle={columns > 1 && styles.columns}
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
