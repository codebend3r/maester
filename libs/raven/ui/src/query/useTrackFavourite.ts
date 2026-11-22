import type { ApiClient, Track } from '@raven/core'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { afterFavourites } from '@/query/invalidate'
import type { RavenQueries } from '@/query/ravenQueries'

type UseTrackFavouriteProps = {
  api: ApiClient
  queries: RavenQueries
  track: Track
  onFailure: (error: unknown) => void
}

/** A song's favourite as a row or a menu shows it, and the press that turns it on or off. */
type TrackFavourite = { isLiked: boolean; onToggle: () => void }

/**
 * Whether a song is a favourite, read from its library's favourites, and the press that turns it
 * on or off. The new state shows at once and holds until the favourites are read again. The press
 * is a plain call rather than a `useMutation`, since every row of a list holds this hook and a
 * mutation observer apiece made a page of songs slow to draw.
 */
export const useTrackFavourite = ({
  api,
  queries,
  track,
  onFailure,
}: UseTrackFavouriteProps): TrackFavourite => {
  const queryClient = useQueryClient()
  const favourites = useQuery(queries.libraryFavouritesQuery(track.libraryId))
  const [pending, setPending] = useState<boolean | null>(null)
  const isListed = (favourites.data ?? []).some(({ media }) => media.id === track.id)
  const isLiked = pending ?? isListed
  const mark = async (isMarked: boolean): Promise<void> => {
    setPending(isMarked)
    await api.setFavourite({ id: track.id, favourite: isMarked }).catch(onFailure)
    await afterFavourites(queryClient).catch(onFailure)
    setPending(null)
  }
  return {
    isLiked,
    onToggle: () => {
      mark(!isLiked).catch(onFailure)
    },
  }
}
