import { plural } from '@raven/core'
import {
  COUNTS_COPY,
  FIRST_LIST_ORDER,
  LIBRARY_PAGE_COPY,
  type ListOrder,
  listOrderOf,
  matchingAlbums,
  sortedAlbums,
} from '@raven/wren'
import { useState } from 'react'
import { AlbumGrid } from '@/components/AlbumGrid/AlbumGrid'
import { ListNotice } from '@/components/ListNotice/ListNotice'
import { useAllAlbums } from '@/music/listings'
import { CollectionHeader } from '@/screens/Collection/CollectionHeader'
import { CoverSizeButton } from '@/screens/Collection/CoverSizeButton'
import { SortButton } from '@/screens/Collection/SortButton'
import { useCollectionSearch } from '@/screens/Collection/useCollectionSearch'
import { Page } from '@/shell/Page/Page'
import { useWrenPrefs } from '@/stores/wrenPrefs'
import styles from '@/screens/Collection/Collection.module.scss'

/**
 * Albums: every music library's, found by what is typed and put in raven's order picked, both in
 * the browser, as a grid of as many covers a row as the cover size picked allows.
 */
export function AlbumsCollection() {
  const search = useCollectionSearch({
    placeholder: LIBRARY_PAGE_COPY.searchAlbums,
    none: LIBRARY_PAGE_COPY.noAlbums,
  })
  const [order, setOrder] = useState<ListOrder>(FIRST_LIST_ORDER)
  const coverSize = useWrenPrefs((state) => state.coverSize)
  const { albums, listing } = useAllAlbums({ search: '' })
  const shown = sortedAlbums({ albums: matchingAlbums({ albums, query: search.query }), order })
  const count = listing.isRead ? plural({ n: shown.length, ...COUNTS_COPY.albums }) : null
  return (
    <Page className={styles.grid}>
      <CollectionHeader
        count={count}
        search={search.field}
        title={LIBRARY_PAGE_COPY.albums}
        tools={
          <>
            <SortButton onSort={(sort) => setOrder(listOrderOf(sort))} sort={order.sort} />
            <CoverSizeButton />
          </>
        }
      />
      {shown.length === 0 && <ListNotice empty={search.empty} listing={listing} />}
      <AlbumGrid albums={shown} tileSize={coverSize} />
    </Page>
  )
}
