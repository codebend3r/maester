import type { ListState } from '@/library/listState'

/** Where a search stands: raven has no music, it failed, it is on its way, nothing matched, or it found some. */
export const RESULT_STATES = {
  noMusic: 'noMusic',
  failed: 'failed',
  searching: 'searching',
  empty: 'empty',
  found: 'found',
} as const

export type ResultState = (typeof RESULT_STATES)[keyof typeof RESULT_STATES]

type StateOfProps = ListState & { hasAny: boolean }

const stateOf = ({ hasNoMusic, failure, hasAny, isRead }: StateOfProps): ResultState => {
  if (hasNoMusic) return RESULT_STATES.noMusic
  if (failure !== null) return RESULT_STATES.failed
  if (hasAny) return RESULT_STATES.found
  return isRead ? RESULT_STATES.empty : RESULT_STATES.searching
}

type ResultStateOfProps = {
  albums: ListState
  artists: ListState
  songs: ListState
  /** Whether an album, an artist or a song has been found so far. */
  hasAny: boolean
}

/**
 * Where a search stands, and why it failed when it did: the first failure among the albums, the
 * artists and the songs; found as soon as any of them has an entry, and empty only once all
 * three have answered with none.
 */
export const resultStateOf = ({ albums, artists, songs, hasAny }: ResultStateOfProps) => {
  const failure = albums.failure ?? artists.failure ?? songs.failure
  return {
    state: stateOf({
      hasNoMusic: albums.hasNoMusic,
      failure,
      hasAny,
      isRead: albums.isRead && artists.isRead && songs.isRead,
    }),
    failure,
  }
}
