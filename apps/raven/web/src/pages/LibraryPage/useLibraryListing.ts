import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { LibrarySettings, MediaItem } from '@raven/core'
import { useEffect, useRef } from 'react'
import { afterMatchingPass } from '@/lib/invalidate'
import { mediaListQuery, metadataHealthQuery, showListQuery } from '@/lib/queries'
import type { Listing } from '@/pages/LibraryPage/libraryShape'

const POLL_MS = 3000

const anyPending = (items: readonly MediaItem[]): boolean =>
  items.some((item) => item.match === 'pending')

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
  enabled,
  scanning,
}: {
  libraryId: number
  settings: LibrarySettings
  search: string
  seed: number
  enabled: boolean
  scanning: boolean
}): Listing & {
  /** Whether the shows are listed apart from the files: a TV library's are. */
  listsShows: boolean
  loaded: boolean
  busy: boolean
  /** Whether TMDB answers, so pending files will leave pending. */
  canMatch: boolean
} => {
  const queryClient = useQueryClient()
  const listsShows = settings.kind === 'shows'
  // Files only leave pending while TMDB answers; without it they wait for good.
  const metadata = useQuery({ ...metadataHealthQuery, enabled: settings.kind !== 'other' })
  const canMatch = metadata.data?.tmdb === 'ok'
  const listing = { libraryId, search, sort: settings.sort, seed }

  const shows = useQuery({
    ...showListQuery(listing),
    enabled: enabled && listsShows,
    refetchInterval: (current) =>
      scanning || (canMatch && anyPending(current.state.data?.unmatched ?? [])) ? POLL_MS : false,
  })
  const files = useQuery({
    ...mediaListQuery(listing),
    enabled: enabled && !listsShows,
    refetchInterval: (current) =>
      scanning ||
      (current.state.data ?? []).some(
        (item) => item.thumbnail === 'pending' || (canMatch && item.match === 'pending'),
      )
        ? POLL_MS
        : false,
  })

  const shown = listsShows
    ? { shows: shows.data?.shows ?? [], files: shows.data?.unmatched ?? [], query: shows }
    : { shows: [], files: files.data ?? [], query: files }

  // Nothing else reads the library again after a matching pass, so its count
  // of files not matched is refetched once the listing has none pending.
  const isMatching = anyPending(shown.files)
  const wasMatching = useRef(false)
  useEffect(() => {
    if (wasMatching.current && !isMatching) void afterMatchingPass({ queryClient, libraryId })
    wasMatching.current = isMatching
  }, [isMatching, libraryId, queryClient])

  return {
    shows: shown.shows,
    files: shown.files,
    listsShows,
    loaded: shown.query.isSuccess,
    busy: shown.query.isFetching && !shown.query.data,
    canMatch,
  }
}
