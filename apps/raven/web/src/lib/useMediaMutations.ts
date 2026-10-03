import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { MediaItem } from '@raven/core'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/queryClient'

/**
 * Marking a favourite and deleting a video, with every cached list patched
 * in place so the grid answers at once. The favourites list and the library
 * counts refetch behind that.
 */
export const useMediaMutations = ({ media }: { media: MediaItem }) => {
  const queryClient = useQueryClient()
  const lists = { queryKey: queryKeys.mediaLists(media.libraryId) }
  const without = (items: MediaItem[] | undefined): MediaItem[] | undefined =>
    items?.filter((item) => item.id !== media.id)

  const favourite = useMutation({
    mutationFn: (marked: boolean) => api.setFavourite({ id: media.id, favourite: marked }),
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKeys.mediaItem(updated.id), updated)
      queryClient.setQueriesData<MediaItem[]>(lists, (items) =>
        items?.map((item) => (item.id === updated.id ? updated : item)),
      )
      if (!updated.favourite) queryClient.setQueryData<MediaItem[]>(queryKeys.favourites, without)
      return queryClient.invalidateQueries({ queryKey: queryKeys.favourites })
    },
  })

  const remove = useMutation({
    mutationFn: () => api.deleteMedia(media.id),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: queryKeys.mediaItem(media.id) })
      queryClient.setQueriesData<MediaItem[]>(lists, without)
      queryClient.setQueryData<MediaItem[]>(queryKeys.favourites, without)
      return queryClient.invalidateQueries({ queryKey: queryKeys.libraries })
    },
  })

  return { favourite, remove }
}
