import { LIST_SORTS, resultStateOf } from '@raven/wren'

import { useAllAlbums, useAllArtists, useAllSongs } from '@/screens/library/listings'
import type { WrenSession } from '@/useWren'

type UseSearchResultsProps = { session: WrenSession; query: string }

/**
 * Albums, artists and songs matching `query` in every music library. Nothing is asked for
 * while the query is blank; `useSearch` hands it over only once typing pauses.
 */
export const useSearchResults = ({ session, query }: UseSearchResultsProps) => {
  const isAsked = query !== ''
  const { albums, listing: albumListing } = useAllAlbums({
    session,
    search: query,
    isEnabled: isAsked,
  })
  const { artists, listing: artistListing } = useAllArtists({
    session,
    search: query,
    isEnabled: isAsked,
  })
  const songs = useAllSongs({
    session,
    search: query,
    sort: LIST_SORTS.title,
    isEnabled: isAsked,
  })
  return {
    ...resultStateOf({
      albums: albumListing,
      artists: artistListing,
      songs: songs.listing,
      hasAny: albums.length + artists.length + songs.tracks.length > 0,
    }),
    albums,
    artists,
    songs: songs.tracks,
    nextSongs: songs.nextPage,
  }
}

export type SearchResults = ReturnType<typeof useSearchResults>
