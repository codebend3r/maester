import { plural } from '@raven/core'
import { COUNTS_COPY, LIBRARY_PAGE_COPY, matchingArtists } from '@raven/wren'

import { ListNotice } from '@/components/ListNotice'
import { useCovers, useAllArtists } from '@raven/wren-native'
import { ArtistTileOf } from '@/components/ArtistTileOf'
import { CollectionGrid } from '@/screens/library/CollectionGrid'
import { CollectionHeader } from '@/screens/library/CollectionHeader'
import type { CollectionPageProps } from '@/screens/library/CollectionPage'
import { useCollectionSearch } from '@/screens/library/useCollectionSearch'
import { SIZE } from '@/theme/tvTokens'

/**
 * Artists: every music library's, each once, by name, as a grid of round tiles. A TV has no A to
 * Z rail: the remote moves down the grid, and the search box finds a name.
 */
export function ArtistsCollection({ session }: CollectionPageProps) {
  const search = useCollectionSearch({
    placeholder: LIBRARY_PAGE_COPY.searchArtists,
    none: LIBRARY_PAGE_COPY.noArtists,
  })
  const { artists, listing } = useAllArtists({ session, search: '' })
  const { artistPhotoOf } = useCovers(session)
  const shown = matchingArtists({ artists, query: search.query })
  const count = listing.isRead ? plural({ n: shown.length, ...COUNTS_COPY.artists }) : null
  return (
    <CollectionGrid
      empty={<ListNotice empty={search.empty} listing={listing} />}
      header={
        <CollectionHeader count={count} search={search.field} title={LIBRARY_PAGE_COPY.artists} />
      }
      items={shown}
      keyOf={(artist) => artist.id}
      renderTile={(artist) => <ArtistTileOf artist={artist} photoOf={artistPhotoOf} />}
      tile={SIZE.artistPhoto}
    />
  )
}
