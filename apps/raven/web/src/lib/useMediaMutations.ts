import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { MediaItem, PosterEntry } from '@raven/core'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/queryClient'

/**
 * Marking a favourite, deleting a video and fetching its details again,
 * with every cached list patched
 * in place so the grid answers at once. The favourites list, home and the
 * library counts refetch behind that.
 */
export const useMediaMutations = ({ media }: { media: MediaItem }) => {
  const queryClient = useQueryClient()
  const lists = { queryKey: queryKeys.mediaLists(media.libraryId) }
  const showLists = { queryKey: queryKeys.showLists(media.libraryId) }
  const without = (items: MediaItem[] | undefined): MediaItem[] | undefined =>
    items?.filter((item) => item.id !== media.id)
  const withoutFavourite = (entries: PosterEntry[] | undefined): PosterEntry[] | undefined =>
    entries?.filter((entry) => entry.media.id !== media.id)

  const favourite = useMutation({
    mutationFn: (marked: boolean) => api.setFavourite({ id: media.id, favourite: marked }),
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKeys.mediaItem(updated.id), updated)
      queryClient.setQueriesData<MediaItem[]>(lists, (items) =>
        items?.map((item) => (item.id === updated.id ? updated : item)),
      )
      if (!updated.favourite) {
        queryClient.setQueryData<PosterEntry[]>(queryKeys.favourites, withoutFavourite)
      }
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.favourites }),
        queryClient.invalidateQueries({ queryKey: queryKeys.items }),
        queryClient.invalidateQueries(showLists),
        queryClient.invalidateQueries({ queryKey: queryKeys.home }),
      ])
    },
  })

  const remove = useMutation({
    mutationFn: () => api.deleteMedia(media.id),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: queryKeys.mediaItem(media.id) })
      queryClient.setQueriesData<MediaItem[]>(lists, without)
      queryClient.setQueryData<PosterEntry[]>(queryKeys.favourites, withoutFavourite)
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.libraries }),
        queryClient.invalidateQueries({ queryKey: queryKeys.items }),
        queryClient.invalidateQueries(showLists),
        queryClient.invalidateQueries({ queryKey: queryKeys.home }),
      ])
    },
  })

  // A refresh can change titles, posters and credits anywhere the item shows.
  const refresh = useMutation({
    mutationFn: (itemId: number) => api.refreshItem(itemId),
    onSuccess: (details) => {
      queryClient.setQueryData(queryKeys.item(details.id), details)
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: lists.queryKey }),
        queryClient.invalidateQueries(showLists),
        queryClient.invalidateQueries({ queryKey: queryKeys.items }),
        queryClient.invalidateQueries({ queryKey: queryKeys.home }),
      ])
    },
  })

  return { favourite, remove, refresh }
}
