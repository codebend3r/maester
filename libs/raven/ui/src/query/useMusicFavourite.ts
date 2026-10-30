import { useQueryClient } from '@tanstack/react-query'
import type { ApiClient } from '@raven/core'
import { albumFavouriteEdits, artistFavouriteEdits } from '@/query/edits'
import { afterMusicFavourites } from '@/query/invalidate'
import { useOptimisticMutation } from '@/query/optimistic'
import { mutationKeys } from '@/query/queryClient'

type UseServerAlbumFavouriteProps = { api: ApiClient; albumId: number }

/** Marking an album a favourite, shown on its page before the server answers. */
export const useServerAlbumFavourite = ({ api, albumId }: UseServerAlbumFavouriteProps) => {
  const queryClient = useQueryClient()
  return useOptimisticMutation({
    mutationKey: mutationKeys.musicFavourite,
    mutationFn: (isMarked: boolean) => api.setAlbumFavourite({ albumId, favourite: isMarked }),
    edits: (isMarked) => albumFavouriteEdits({ albumId, favourite: isMarked }),
    settle: () => afterMusicFavourites(queryClient),
  })
}

type UseServerArtistFavouriteProps = { api: ApiClient; artistId: number }

/** Marking an artist a favourite, shown on their page before the server answers. */
export const useServerArtistFavourite = ({ api, artistId }: UseServerArtistFavouriteProps) => {
  const queryClient = useQueryClient()
  return useOptimisticMutation({
    mutationKey: mutationKeys.musicFavourite,
    mutationFn: (isMarked: boolean) => api.setArtistFavourite({ artistId, favourite: isMarked }),
    edits: (isMarked) => artistFavouriteEdits({ artistId, favourite: isMarked }),
    settle: () => afterMusicFavourites(queryClient),
  })
}

type MusicFavouritesForProps = { api: ApiClient }

type MusicFavouritesForUseAlbumFavouriteProps = { albumId: number }

type MusicFavouritesForUseArtistFavouriteProps = { artistId: number }

/** The album and artist favourite hooks over one server's `api`, for a host with one server. */
export const musicFavouritesFor = ({ api }: MusicFavouritesForProps) => ({
  useAlbumFavourite: ({ albumId }: MusicFavouritesForUseAlbumFavouriteProps) =>
    useServerAlbumFavourite({ api, albumId }),
  useArtistFavourite: ({ artistId }: MusicFavouritesForUseArtistFavouriteProps) =>
    useServerArtistFavourite({ api, artistId }),
})
