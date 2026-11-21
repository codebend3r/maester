import { type Library, musicLibrariesOf } from '@raven/core'
import { useQuery } from '@tanstack/react-query'
import { queries } from '@/lib/queries'

const NO_LIBRARIES: readonly Library[] = []

/**
 * The server's music libraries, the ones it lists by album, in its order; empty while they are
 * read. `isRead` says whether they have been, and `failure` why they could not be.
 */
export const useMusicLibraries = () => {
  const libraries = useQuery(queries.librariesQuery)
  const music = musicLibrariesOf(libraries.data ?? NO_LIBRARIES)
  return { libraries: music, isRead: libraries.isSuccess, failure: libraries.error }
}
