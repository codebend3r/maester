import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type MediaItem, type PosterEntry, isMediaItem, isPosterEntry } from '@raven/core'
import { api } from '@/lib/api'
import { type Patch, optimisticChange, patchEvery, patchQueries } from '@/lib/optimistic'
import { mutationKeys, queryKeys } from '@/lib/queryClient'

/** A list of poster entries without the one for video `id`; anything else as it was. */
const withoutEntry =
  (id: number): Patch =>
  (data) => {
    if (!Array.isArray(data)) return data
    const entries: readonly unknown[] = data
    const kept = entries.filter((entry) => !(isPosterEntry(entry) && entry.media.id === id))
    return kept.length === entries.length ? data : kept
  }

/**
 * Marking a favourite, deleting a video and fetching its details again,
 * with every cached list patched in place so the grid answers at once. A
 * favourite shows before the server answers, on every card, row and page
 * holding the video, and leaves the favourites at once when unmarked.
 * Behind that, everything its library shows refetches: the listings and
 * every tab, In progress, Not matched, its sagas and its history among
 * them, so no menu there is left stale. So do the favourites, the item
 * pages and home.
 */
export const useMediaMutations = ({ media }: { media: MediaItem }) => {
  const queryClient = useQueryClient()
  const lists = { queryKey: queryKeys.mediaLists(media.libraryId) }
  const library = { queryKey: queryKeys.library(media.libraryId) }
  const without = (items: MediaItem[] | undefined): MediaItem[] | undefined =>
    items?.filter((item) => item.id !== media.id)
  const withoutFavourite = (entries: PosterEntry[] | undefined): PosterEntry[] | undefined =>
    entries?.filter((entry) => entry.media.id !== media.id)

  const favourite = useMutation({
    mutationFn: (marked: boolean) => api.setFavourite({ id: media.id, favourite: marked }),
    ...optimisticChange<boolean>({
      queryClient,
      mutationKey: mutationKeys.favourite(media.id),
      // Everywhere the video shows: its library's listings and tabs, the
      // favourites, home, the item pages and its own.
      apply: async (marked) => [
        ...(await patchQueries({
          queryClient,
          filters: [
            library,
            { queryKey: queryKeys.favourites },
            { queryKey: queryKeys.home },
            { queryKey: queryKeys.items },
            { queryKey: queryKeys.mediaItem(media.id), exact: true },
          ],
          patch: patchEvery({
            guard: isMediaItem,
            id: media.id,
            patch: (item) => ({ ...item, favourite: marked }),
          }),
        })),
        ...(marked
          ? []
          : await patchQueries({
              queryClient,
              filters: [
                { queryKey: queryKeys.favourites, exact: true },
                { queryKey: queryKeys.libraryFavourites(media.libraryId), exact: true },
              ],
              patch: withoutEntry(media.id),
            })),
      ],
      settle: () =>
        Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.mediaItem(media.id), exact: true }),
          queryClient.invalidateQueries(library),
          queryClient.invalidateQueries({ queryKey: queryKeys.favourites }),
          queryClient.invalidateQueries({ queryKey: queryKeys.items }),
          queryClient.invalidateQueries({ queryKey: queryKeys.home }),
        ]),
    }),
  })

  const remove = useMutation({
    mutationFn: () => api.deleteMedia(media.id),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: queryKeys.mediaItem(media.id) })
      queryClient.setQueriesData<MediaItem[]>(lists, without)
      queryClient.setQueryData<PosterEntry[]>(queryKeys.favourites, withoutFavourite)
      // Every library, the counts on the libraries list with them.
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.libraries }),
        queryClient.invalidateQueries({ queryKey: queryKeys.items }),
        queryClient.invalidateQueries({ queryKey: queryKeys.home }),
      ])
    },
  })

  // A refresh can change titles, posters, credits and sagas anywhere the item shows.
  const refresh = useMutation({
    mutationFn: (itemId: number) => api.refreshItem(itemId),
    onSuccess: (details) => {
      queryClient.setQueryData(queryKeys.item(details.id), details)
      return Promise.all([
        queryClient.invalidateQueries(library),
        queryClient.invalidateQueries({ queryKey: queryKeys.items }),
        queryClient.invalidateQueries({ queryKey: queryKeys.home }),
      ])
    },
  })

  return { favourite, remove, refresh }
}
