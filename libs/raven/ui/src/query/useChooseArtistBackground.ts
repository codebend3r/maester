import type { ApiClient, ArtistDetails } from '@raven/core'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/query/queryClient'

type UseChooseArtistBackgroundProps = {
  api: ApiClient
  artistId: number
  /** Called once the server has taken the choice, as the picker closes. */
  onChosen: () => void
  onFailure: (error: unknown) => void
}

/**
 * Sets the artist's background to the option with a key, or to the default photo with null. The
 * page's artist is replaced by the answer, so the hero draws the new picture at once, and the
 * options are read again behind it.
 */
export const useChooseArtistBackground = ({
  api,
  artistId,
  onChosen,
  onFailure,
}: UseChooseArtistBackgroundProps) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (key: string | null) => api.setArtistBackground({ artistId, key }),
    onSuccess: (details: ArtistDetails) => {
      queryClient.setQueryData(queryKeys.artist(artistId), details)
      queryClient
        .invalidateQueries({ queryKey: queryKeys.artistBackgrounds(artistId) })
        .catch(onFailure)
      onChosen()
    },
    onError: onFailure,
  })
}
