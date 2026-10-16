import { type Infer, oneOf } from '@/schema'

/** The most targets one `PUT /api/watched` marks; a longer selection is sent in parts. */
export const MAX_WATCH_TARGETS = 5000

/** How much of a group of videos is watched: none, some, or all of it. */
export const isWatchedState = oneOf(['unwatched', 'partly', 'watched'])

export type WatchedState = Infer<typeof isWatchedState>

/** An empty group has nothing to have watched, so it reads unwatched. */
export const watchedStateOf = ({
  watched,
  total,
}: {
  watched: number
  total: number
}): WatchedState => {
  if (watched <= 0) return 'unwatched'
  return watched >= total ? 'watched' : 'partly'
}
