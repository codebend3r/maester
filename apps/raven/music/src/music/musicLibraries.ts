import { type Library, musicLibrariesOf } from '@raven/core'
import { wornLibrariesOf } from '@raven/wren'
import { useQuery } from '@tanstack/react-query'

import { useWrenPrefs } from '@/stores/wrenPrefs'
import type { WrenSession } from '@/useWren'

const NO_LIBRARIES: readonly Library[] = []

type UseMusicLibrariesProps = Pick<WrenSession, 'queries'>

/**
 * The music library Wren shows, as the list every listing reads: the one picked in Settings,
 * else the server's first; empty while the libraries are read. `all` is every music library the
 * server has, in its order, for the place that picks one. `isRead` says whether they have been
 * read, and `failure` why they could not be.
 */
export const useMusicLibraries = ({ queries }: UseMusicLibrariesProps) => {
  const libraries = useQuery(queries.librariesQuery)
  const libraryId = useWrenPrefs((state) => state.libraryId)
  const all = musicLibrariesOf(libraries.data ?? NO_LIBRARIES)
  return {
    libraries: wornLibrariesOf({ libraries: all, libraryId }),
    all,
    isRead: libraries.isSuccess,
    failure: libraries.error,
  }
}
