import { type ApiClient, WATCHED_STATES, type WatchedChange, type WatchedState } from '@raven/core'
import { useQueryClient } from '@tanstack/react-query'
import { afterWatched } from '@/query/invalidate'
import { useOptimisticMutation } from '@/query/optimistic'
import { mutationKeys } from '@/query/queryClient'

/** The watched-change hooks over one server's `api`. */
export const watchedChangeFor = ({ api }: { api: ApiClient }) => {
  /**
   * Marks whatever `targets` name watched or unwatched when the cache cannot
   * be patched ahead of the answer: a show, season or saga, whose counts and
   * next episode only the server knows. It shares a key, so a queue, with a
   * video's own optimistic mark, and everything marked is read again once the
   * last of them settles.
   */
  const useWatchedChange = () => {
    const queryClient = useQueryClient()
    return useOptimisticMutation({
      mutationKey: mutationKeys.watched,
      mutationFn: (change: WatchedChange) => api.setWatched(change),
      edits: () => [],
      settle: () => afterWatched(queryClient),
    })
  }

  /**
   * What a Watched toggle needs: pressing it marks everything `targets` name
   * watched, unless it all is already, and then unwatched.
   */
  const useWatchedToggle = ({
    state,
    targets,
  }: {
    state: WatchedState
    targets: WatchedChange['targets']
  }) => {
    const { mutate } = useWatchedChange()
    return { state, onToggle: () => mutate({ watched: state !== WATCHED_STATES.watched, targets }) }
  }
  return { useWatchedChange, useWatchedToggle }
}
