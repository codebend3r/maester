import { FIRST_LIST_ORDER, resultStateOf } from '@raven/wren'
import { useAllAlbums, useAllArtists, useAllSongs } from '@/music/listings'

type UseSearchResultsProps = { query: string }

/**
 * Albums, artists and songs matching `query` in every music library. Nothing is asked for
 * while the query is blank; `useSearch` hands it over only once typing pauses.
 */
export const useSearchResults = ({ query }: UseSearchResultsProps) => {
  const isAsked = query !== ''
  const { albums, listing: albumListing } = useAllAlbums({ search: query, isEnabled: isAsked })
  const { artists, listing: artistListing } = useAllArtists({ search: query, isEnabled: isAsked })
  const songs = useAllSongs({ search: query, order: FIRST_LIST_ORDER, isEnabled: isAsked })
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
