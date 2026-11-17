import { MUSIC_SORTS } from '@raven/core'
import { useInfiniteQuery } from '@tanstack/react-query'

import { nextPageOf } from '@/music/nextPage'
import { useAllAlbums, useAllArtists } from '@/screens/library/listings'
import type { WrenSession } from '@/useWren'

/** Where a search stands: raven has no music, it failed, it is on its way, nothing matched, or it found some. */
export const RESULT_STATES = {
  noMusic: 'noMusic',
  failed: 'failed',
  searching: 'searching',
  empty: 'empty',
  found: 'found',
} as const

export type ResultState = (typeof RESULT_STATES)[keyof typeof RESULT_STATES]

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
  const {
    artists,
    listing: artistListing,
    music,
  } = useAllArtists({
    session,
    search: query,
    isEnabled: isAsked,
  })
  // A blank search names no library, so it asks for no songs.
  const songs = useInfiniteQuery(
    session.queries.songsQuery({
      libraryIds: isAsked ? music.libraries.map(({ id }) => id) : [],
      search: query,
      sort: MUSIC_SORTS.title,
    }),
  )
  const tracks = isAsked ? (songs.data?.pages.flatMap((page) => page.tracks) ?? []) : []
  const failure = albumListing.failure ?? artistListing.failure ?? songs.error
  const hasAny = albums.length + artists.length + tracks.length > 0
  const isRead = albumListing.isRead && artistListing.isRead && songs.isSuccess
  const state = ((): ResultState => {
    if (albumListing.hasNoMusic) return RESULT_STATES.noMusic
    if (failure !== null) return RESULT_STATES.failed
    if (hasAny) return RESULT_STATES.found
    return isRead ? RESULT_STATES.empty : RESULT_STATES.searching
  })()
  return {
    state,
    failure,
    albums,
    artists,
    songs: tracks,
    nextSongs: nextPageOf(songs),
  }
}

export type SearchResults = ReturnType<typeof useSearchResults>
