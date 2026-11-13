import type { Library } from '@raven/core'
import { useQuery } from '@tanstack/react-query'

import type { WrenSession } from '@/useWren'
import { musicLibrariesOf } from '@raven/core'

/** What a page says while it waits, and when raven holds no music. */
export const LIBRARY_COPY = {
  loading: 'Loading',
  noMusic: 'raven has no music library yet.',
} as const

const NO_LIBRARIES: readonly Library[] = []

type UseMusicLibrariesProps = Pick<WrenSession, 'queries'>

/**
 * The server's music libraries, the ones it lists by album, in its order; empty while they are
 * read. `isRead` says whether they have been, and `failure` why they could not be.
 */
export const useMusicLibraries = ({ queries }: UseMusicLibrariesProps) => {
  const libraries = useQuery(queries.librariesQuery)
  const music = musicLibrariesOf(libraries.data ?? NO_LIBRARIES)
  return { libraries: music, isRead: libraries.isSuccess, failure: libraries.error }
}
