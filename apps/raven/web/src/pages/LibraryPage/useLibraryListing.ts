import { useQuery } from '@tanstack/react-query'
import {
  type LibrarySettings,
  MATCH_STATES,
  METADATA_SERVICE_STATES,
  THUMBNAIL_STATES,
  listsShows,
  matchTypeFor,
} from '@raven/core'
import { mediaListQuery, metadataHealthQuery, showListQuery } from '@/lib/queries'
import type { Listing, ListingState } from '@/pages/LibraryPage/libraryShape'
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
}): ListingState => {
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

  const query = isShowList ? shows : files
  const listed: Listing | null = isShowList
    ? shows.data
      ? { shows: shows.data.shows, files: shows.data.unmatched }
      : null
    : files.data
      ? { shows: [], files: files.data }
      : null

  useMatchingPassDone({ libraryId, files: listed?.files ?? [] })

  // A failed read again keeps what was read before.
  if (listed) return { state: 'listed', ...listed }
  if (query.error) return { state: 'failed', error: query.error }
  return { state: 'pending' }
}
