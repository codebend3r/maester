import { useQuery } from '@tanstack/react-query'
import { type LibrarySettings, listsShows, matchTypeFor } from '@raven/core'
import { mediaListQuery, metadataHealthQuery, showListQuery } from '@/lib/queries'
import type { Listing } from '@/pages/LibraryPage/libraryShape'
import { POLL_MS, anyPending, useMatchingPassDone } from '@/pages/LibraryPage/useMatchingPassDone'

/**
 * What a library lists, one shape whatever its type: a TV library's shows
 * and the files no show was found for, or every file of any other. While a
 * scan runs, or thumbnails are made or files matched, it keeps filling in.
 */
export const useLibraryListing = ({
  libraryId,
  settings,
  search,
  seed,
  scanning,
}: {
  libraryId: number
  settings: LibrarySettings
  search: string
  seed: number
  scanning: boolean
}): Listing & {
  /** Nothing read yet. */
  pending: boolean
  /** Why nothing could be read; a failed read again keeps what was. */
  error: Error | null
} => {
  const isShowList = listsShows(settings.kind)
  // Files only leave pending while TMDB answers; without it they wait for good.
  const metadata = useQuery({
    ...metadataHealthQuery,
    enabled: matchTypeFor(settings.kind) != null,
  })
  const canMatch = metadata.data?.tmdb === 'ok'
  const listing = { libraryId, search, sort: settings.sort, seed }

  const shows = useQuery({
    ...showListQuery(listing),
    enabled: isShowList,
    refetchInterval: (current) =>
      scanning || (canMatch && anyPending(current.state.data?.unmatched ?? [])) ? POLL_MS : false,
  })
  const files = useQuery({
    ...mediaListQuery(listing),
    enabled: !isShowList,
    refetchInterval: (current) =>
      scanning ||
      (current.state.data ?? []).some(
        (item) => item.thumbnail === 'pending' || (canMatch && item.match === 'pending'),
      )
        ? POLL_MS
        : false,
  })

  const shown = isShowList
    ? { shows: shows.data?.shows ?? [], files: shows.data?.unmatched ?? [], query: shows }
    : { shows: [], files: files.data ?? [], query: files }

  useMatchingPassDone({ libraryId, files: shown.files })

  return {
    shows: shown.shows,
    files: shown.files,
    pending: shown.query.isPending,
    error: shown.query.data === undefined ? shown.query.error : null,
  }
}
