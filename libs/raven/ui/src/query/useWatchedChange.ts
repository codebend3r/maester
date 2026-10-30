import {
  type ApiClient,
  WATCHED_STATES,
  WATCH_TARGET_KINDS,
  type WatchedChange,
  type WatchedState,
} from '@raven/core'
import { useQueryClient } from '@tanstack/react-query'
import { itemWatchedEdits } from '@/query/edits'
import { afterWatched } from '@/query/invalidate'
import { useOptimisticMutation } from '@/query/optimistic'
import { mutationKeys } from '@/query/queryClient'

type UseServerWatchedChangeProps = { api: ApiClient }

/**
 * Marks whatever `targets` name watched or unwatched. A show or season shows
 * at once from the pages already cached (`itemWatchedEdits`); anything else
 * waits for the server. It shares a key, so a queue, with a video's own
 * optimistic mark, and everything marked is read again once the last of them
 * settles.
 */
const useServerWatchedChange = ({ api }: UseServerWatchedChangeProps) => {
  const queryClient = useQueryClient()
  return useOptimisticMutation({
    mutationKey: mutationKeys.watched,
    mutationFn: (change: WatchedChange) => api.setWatched(change),
    edits: (change: WatchedChange) =>
      change.targets.flatMap((target) =>
        target.kind === WATCH_TARGET_KINDS.item
          ? itemWatchedEdits({ itemId: target.id, watched: change.watched })
          : [],
      ),
    settle: () => afterWatched(queryClient),
  })
}

type UseServerWatchedToggleProps = {
  api: ApiClient
  state: WatchedState
  targets: WatchedChange['targets']
}

/**
 * What a Watched toggle needs: pressing it marks everything `targets` name
 * watched, unless it all is already, and then unwatched.
 */
export const useServerWatchedToggle = ({ api, state, targets }: UseServerWatchedToggleProps) => {
  const { mutate } = useServerWatchedChange({ api })
  return { state, onToggle: () => mutate({ watched: state !== WATCHED_STATES.watched, targets }) }
}

type WatchedChangeForProps = { api: ApiClient }

type WatchedChangeForUseWatchedToggleProps = {
  state: WatchedState
  targets: WatchedChange['targets']
}

/** The watched-change hooks over one server's `api`, for a host with one server. */
export const watchedChangeFor = ({ api }: WatchedChangeForProps) => ({
  useWatchedChange: () => useServerWatchedChange({ api }),
  useWatchedToggle: ({ state, targets }: WatchedChangeForUseWatchedToggleProps) =>
    useServerWatchedToggle({ api, state, targets }),
})
