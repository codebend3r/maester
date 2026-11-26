import { plural } from '@raven/core'
import { COUNTS_COPY, LIBRARY_PAGE_COPY } from '@raven/wren'

import { ListNotice } from '@/components/ListNotice'
import { useCovers, useUnmatchedAlbums } from '@raven/wren-native'
import { AlbumTileOf } from '@/components/AlbumTileOf'
import { CollectionGrid } from '@/screens/library/CollectionGrid'
import { CollectionHeader } from '@/screens/library/CollectionHeader'
import type { CollectionPageProps } from '@/screens/library/CollectionPage'
import { SIZE } from '@/theme/tvTokens'

/**
 * Unmatched albums: every music library's albums no MusicBrainz release was found for, by title,
 * as raven's tab of the name lists them, in a grid of covers.
 */
export function UnmatchedAlbumsCollection({ session }: CollectionPageProps) {
  const { coverOf } = useCovers(session)
  const { albums, listing } = useUnmatchedAlbums(session)
  const isCounted = listing.isRead && albums.length > 0
  return (
    <CollectionGrid
      empty={<ListNotice empty={LIBRARY_PAGE_COPY.noUnmatchedAlbums} listing={listing} />}
      header={
        <CollectionHeader
          count={isCounted ? plural({ n: albums.length, ...COUNTS_COPY.albums }) : null}
          title={LIBRARY_PAGE_COPY.unmatchedAlbums}
        />
      }
      items={albums}
      keyOf={(album) => album.id}
      renderTile={(album) => <AlbumTileOf album={album} coverOf={coverOf} />}
      tile={SIZE.tile}
    />
  )
}
