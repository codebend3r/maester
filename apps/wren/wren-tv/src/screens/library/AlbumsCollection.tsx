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

import { ListNotice } from '@/components/ListNotice'
import { useCovers, useAllAlbums, useCollectionSearch } from '@raven/wren-native'
import { AlbumTileOf } from '@/components/AlbumTileOf'
import { CollectionGrid } from '@/screens/library/CollectionGrid'
import { CollectionHeader } from '@/screens/library/CollectionHeader'
import type { CollectionPageProps } from '@/screens/library/CollectionPage'
import { CoverSizeButton } from '@/screens/library/CoverSizeButton'
import { SortButton } from '@/screens/library/SortButton'
import { useWrenPrefs } from '@/stores/wrenPrefs'
import { SIZE } from '@/theme/tvTokens'

/** Each cover size's tile width on a 1920 point TV: Albums fits as many columns as it holds. */
const COVER_WIDTHS = {
  [COVER_SIZES.extraSmall]: SIZE.coverExtraSmall,
  [COVER_SIZES.small]: SIZE.coverSmall,
  [COVER_SIZES.medium]: SIZE.tile,
  [COVER_SIZES.large]: SIZE.tileLarge,
  [COVER_SIZES.extraLarge]: SIZE.coverExtraLarge,
} as const satisfies Record<CoverSize, number>

/**
 * Albums: every music library's, found by what is typed and put in the order picked, both on the
 * TV, as a grid of as many columns as fit at the cover size kept in the prefs.
 */
export function AlbumsCollection({ session }: CollectionPageProps) {
  const { coverOf } = useCovers(session)
  const search = useCollectionSearch({
    placeholder: LIBRARY_PAGE_COPY.searchAlbums,
    none: LIBRARY_PAGE_COPY.noAlbums,
  })
  const [order, setOrder] = useState<ListOrder>(FIRST_LIST_ORDER)
  const tile = COVER_WIDTHS[useWrenPrefs((state) => state.coverSize)]
  const { albums, listing } = useAllAlbums({ session, search: '' })
  const shown = sortedAlbums({ albums: matchingAlbums({ albums, query: search.query }), order })
  const count = listing.isRead ? plural({ n: shown.length, ...COUNTS_COPY.albums }) : null
  return (
    <CollectionGrid
      empty={<ListNotice empty={search.empty} listing={listing} />}
      header={
        <CollectionHeader count={count} search={search.field} title={LIBRARY_PAGE_COPY.albums}>
          <SortButton onSort={(sort) => setOrder(listOrderOf(sort))} sort={order.sort} />
          <CoverSizeButton />
        </CollectionHeader>
      }
      items={shown}
      keyOf={(album) => album.id}
      renderTile={(album) => <AlbumTileOf album={album} coverOf={coverOf} width={tile} />}
      tile={tile}
    />
  )
}
