import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type ApiClient, type MediaItem, type PosterEntry, WATCH_TARGET_KINDS } from '@raven/core'
import { favouriteEdits, watchedEdits, withoutEntry } from '@/query/edits'
import { afterFavourites, afterWatched } from '@/query/invalidate'
import { useOptimisticMutation } from '@/query/optimistic'
import { mutationKeys, queryKeys } from '@/query/queryClient'

type UseServerMediaMutationsProps = { api: ApiClient; media: MediaItem }

/**
 * Marking a favourite or a watched mark, deleting a video and fetching its
 * details again, with every cached list patched in place so the grid
 * answers at once. A favourite or a mark shows before the server even
 * answers. Behind each, everything its library shows refetches: the
 * listings and every tab, In progress, Not matched, its sagas and its
 * history among them, so no menu there is left stale. So do the favourites,
 * the item pages and home; marks in a run settle together, so every library
 * refetches after them.
 */
export const useServerMediaMutations = ({ api, media }: UseServerMediaMutationsProps) => {
  const queryClient = useQueryClient()
  const lists = { queryKey: queryKeys.mediaLists(media.libraryId) }
  const library = { queryKey: queryKeys.library(media.libraryId) }

  const favourite = useOptimisticMutation({
    mutationKey: mutationKeys.favourite,
    mutationFn: (isMarked: boolean) => api.setFavourite({ id: media.id, favourite: isMarked }),
    edits: (isMarked) => favouriteEdits({ media, favourite: isMarked }),
    settle: () => afterFavourites(queryClient),
  })

  const watched = useOptimisticMutation({
    mutationKey: mutationKeys.watched,
    mutationFn: (isWatched: boolean) =>
      api.setWatched({
        watched: isWatched,
        targets: [{ kind: WATCH_TARGET_KINDS.media, id: media.id }],
      }),
    edits: (isWatched) => watchedEdits({ media, watched: isWatched }),
    settle: () => afterWatched(queryClient),
  })

  const remove = useMutation({
    mutationFn: () => api.deleteMedia(media.id),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: queryKeys.mediaItem(media.id) })
      queryClient.setQueriesData<MediaItem[]>(
        lists,
        (items) => items?.filter((item) => item.id !== media.id) ?? undefined,
      )
      queryClient.setQueryData<PosterEntry[]>(
        queryKeys.favourites,
        (entries) => entries && withoutEntry({ entries, id: media.id }),
      )
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

  return { favourite, watched, remove, refresh }
}

type MediaMutationsForProps = { api: ApiClient }

type MediaMutationsForUseMediaMutationsProps = { media: MediaItem }

/** The media-mutation hook over one server's `api`, for a host with one server. */
export const mediaMutationsFor = ({ api }: MediaMutationsForProps) => ({
  useMediaMutations: ({ media }: MediaMutationsForUseMediaMutationsProps) =>
    useServerMediaMutations({ api, media }),
})
