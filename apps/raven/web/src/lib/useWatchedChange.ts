import type { WatchedChange, WatchedState } from '@raven/core'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { afterWatched } from '@/lib/invalidate'
import { useOptimisticMutation } from '@/lib/optimistic'
import { mutationKeys } from '@/lib/queryClient'

/**
 * Marks whatever `targets` name watched or unwatched when the cache cannot
 * be patched ahead of the answer: a show, season or saga, whose counts and
 * next episode only the server knows. It shares a key, so a queue, with a
 * video's own optimistic mark, and everything marked is read again once the
 * last of them settles.
 */
export const useWatchedChange = () => {
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
export const useWatchedToggle = ({
  state,
  targets,
}: {
  state: WatchedState
  targets: WatchedChange['targets']
}) => {
  const { mutate } = useWatchedChange()
  return { state, onToggle: () => mutate({ watched: state !== 'watched', targets }) }
}
