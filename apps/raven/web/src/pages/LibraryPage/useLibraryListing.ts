import { useQuery } from '@tanstack/react-query'
import {
  type LibrarySettings,
  MATCH_STATES,
  type MediaItem,
  type ShowListing,
  METADATA_SERVICE_STATES,
  THUMBNAIL_STATES,
  listsShows,
  matchTypeFor,
} from '@raven/core'
import { mediaListQuery, metadataHealthQuery, showListQuery } from '@/lib/queries'
import { LISTING_STATES, type Listing, type ListingState } from '@/pages/LibraryPage/libraryShape'
import { seasonsOf } from '@/pages/LibraryPage/seasons'
import { SHOW_LEVELS, type ShowLevel } from '@/lib/showLevels'
import { POLL_MS, anyPending, useMatchingPassDone } from '@/pages/LibraryPage/useMatchingPassDone'

type ReadProps = { shows: ShowListing | undefined; files: MediaItem[] | undefined }

/**
 * How each level's listing is made from what was read: a TV library's shows
 * with the files no show was found for, its seasons, which every episode
 * fills and the shows order and search, or every file, as any other library
 * lists them.
 */
const LISTINGS = {
  [SHOW_LEVELS.shows]: ({ shows }: ReadProps): Listing | null =>
    shows ? { shows: shows.shows, seasons: [], files: shows.unmatched } : null,
  [SHOW_LEVELS.seasons]: ({ shows, files }: ReadProps): Listing | null =>
    shows && files
      ? { shows: [], seasons: seasonsOf({ shows: shows.shows, files }), files: [] }
      : null,
  [SHOW_LEVELS.episodes]: ({ files }: ReadProps): Listing | null =>
    files ? { shows: [], seasons: [], files } : null,
} as const satisfies Record<ShowLevel, (read: ReadProps) => Listing | null>

type UseLibraryListingProps = {
  libraryId: number
  settings: LibrarySettings
  /** What a TV library lists; any other lists its files, as a TV library's episodes are. */
  level: ShowLevel
  search: string
  seed: number
  scanning: boolean
}

/**
 * What a library lists, one shape whatever its type: a TV library's shows
 * and the files no show was found for, its seasons or its episodes, or every
 * file of any other. While a scan runs, or thumbnails are made or files
 * matched, it keeps filling in.
 */
export const useLibraryListing = ({
  libraryId,
  settings,
  level: chosen,
  search,
  seed,
  scanning,
}: UseLibraryListingProps): ListingState => {
  const level = listsShows(settings.kind) ? chosen : SHOW_LEVELS.episodes
  const readsShows = level !== SHOW_LEVELS.episodes
  const readsFiles = level !== SHOW_LEVELS.shows
  // Files only leave pending while TMDB answers; without it they wait for good.
  const metadata = useQuery({
    ...metadataHealthQuery,
    enabled: matchTypeFor(settings.kind) != null,
  })
  const canMatch = metadata.data?.tmdb === METADATA_SERVICE_STATES.ok
  const listing = { libraryId, search, sort: settings.sort, seed }
  // Seasons go by their shows' search and order, so their episodes are read whole.
  const fileListing = level === SHOW_LEVELS.seasons ? { ...listing, search: '' } : listing

  const shows = useQuery({
    ...showListQuery(listing),
    enabled: readsShows,
    refetchInterval: (current) =>
      scanning || (canMatch && anyPending(current.state.data?.unmatched ?? [])) ? POLL_MS : false,
  })
  const files = useQuery({
    ...mediaListQuery(fileListing),
    enabled: readsFiles,
    refetchInterval: (current) =>
      scanning ||
      (current.state.data ?? []).some(
        (item) =>
          item.thumbnail === THUMBNAIL_STATES.pending ||
          (canMatch && item.match === MATCH_STATES.pending),
      )
        ? POLL_MS
        : false,
  })

  const listed = LISTINGS[level]({ shows: shows.data, files: files.data })

  useMatchingPassDone({ libraryId, files: listed?.files ?? [] })

  // A failed read again keeps what was read before.
  if (listed) return { state: LISTING_STATES.listed, ...listed }
  // Only a read this level makes can fail it; another level's may hold an old failure.
  const error = [readsShows && shows.error, readsFiles && files.error].find(
    (failure) => failure instanceof Error,
  )
  if (error) return { state: LISTING_STATES.failed, error }
  return { state: LISTING_STATES.pending }
}
