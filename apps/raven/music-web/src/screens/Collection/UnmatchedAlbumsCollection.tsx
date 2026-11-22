import { plural } from '@raven/core'
import { COUNTS_COPY, LIBRARY_PAGE_COPY } from '@raven/wren'
import { AlbumGrid } from '@/components/AlbumGrid/AlbumGrid'
import { ListNotice } from '@/components/ListNotice/ListNotice'
import { LIST_SHAPES } from '@/components/ListSkeleton/ListSkeleton'
import { useUnmatchedAlbums } from '@/music/listings'
import { CollectionHeader } from '@/screens/Collection/CollectionHeader'
import { Page } from '@/shell/Page/Page'
import styles from '@/screens/Collection/Collection.module.scss'

/**
 * Unmatched albums: every music library's albums no MusicBrainz release was found for, by
 * title, as raven's tab of the name lists them, in a grid of covers.
 */
export function UnmatchedAlbumsCollection() {
  const { albums, listing } = useUnmatchedAlbums()
  const isCounted = listing.isRead && albums.length > 0
  return (
    <Page className={styles.grid}>
      <CollectionHeader
        count={isCounted ? plural({ n: albums.length, ...COUNTS_COPY.albums }) : null}
        title={LIBRARY_PAGE_COPY.unmatchedAlbums}
      />
      {albums.length === 0 && (
        <ListNotice
          empty={LIBRARY_PAGE_COPY.noUnmatchedAlbums}
          listing={listing}
          shape={LIST_SHAPES.tiles}
        />
      )}
      <AlbumGrid albums={albums} />
    </Page>
  )
}
