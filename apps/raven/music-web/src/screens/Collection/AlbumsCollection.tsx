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
import { AlbumGrid } from '@/components/AlbumGrid/AlbumGrid'
import { ListNotice } from '@/components/ListNotice/ListNotice'
import { useAllAlbums } from '@/music/listings'
import { CollectionHeader } from '@/screens/Collection/CollectionHeader'
import { useCollectionSearch } from '@/screens/Collection/useCollectionSearch'
import { Page } from '@/shell/Page/Page'
import styles from '@/screens/Collection/Collection.module.scss'

/**
 * Albums: every music library's, found by what is typed and put in the order picked, both in
 * the browser, as a grid of two columns on the narrow layout and five on the wide.
 */
export function AlbumsCollection() {
  const search = useCollectionSearch({
    placeholder: LIBRARY_PAGE_COPY.searchAlbums,
    none: LIBRARY_PAGE_COPY.noAlbums,
  })
  const [sort, setSort] = useState<ListSort>(LIST_SORTS.title)
  const { albums, listing } = useAllAlbums({ search: '' })
  const shown = sortedAlbums({ albums: matchingAlbums({ albums, query: search.query }), sort })
  const count = listing.isRead ? plural({ n: shown.length, ...COUNTS_COPY.albums }) : null
  return (
    <Page className={styles.grid}>
      <CollectionHeader
        count={count}
        search={search.field}
        sort={{ sort, onSort: setSort }}
        title={LIBRARY_PAGE_COPY.albums}
      />
      {shown.length === 0 && <ListNotice empty={search.empty} listing={listing} />}
      <AlbumGrid albums={shown} />
    </Page>
  )
}
