import { keepPreviousData, queryOptions, skipToken } from '@tanstack/react-query'
import type { MatchItemType, MatchSubject, MediaSort } from '@raven/core'
import { api } from '@/lib/api'
import { playerQueriesFor } from '@/lib/playerQueries'
import { queryKeys } from '@/lib/queryClient'

/**
 * What each query fetches and how long it keeps, paired with its key once,
 * so every page asking for the same thing asks the same way. A page adds
 * only what is its own: when to poll, whether it may run yet.
 */

export const librariesQuery = queryOptions({
  queryKey: queryKeys.libraries,
  queryFn: () => api.listLibraries(),
})

export const libraryQuery = (id: number | null) =>
  queryOptions({
    queryKey: queryKeys.library(id),
    queryFn: id == null ? skipToken : () => api.getLibrary(id),
  })

type Listing = { libraryId: number; search: string; sort: MediaSort; seed: number }

export const mediaListQuery = (listing: Listing) =>
  queryOptions({
    queryKey: queryKeys.media(listing),
    queryFn: () => api.listMedia(listing),
    placeholderData: keepPreviousData,
  })

export const showListQuery = (listing: Listing) =>
  queryOptions({
    queryKey: queryKeys.shows(listing),
    queryFn: () => api.listShows(listing),
    placeholderData: keepPreviousData,
  })

export const historyQuery = ({
  libraryId,
  show,
  limit,
}: {
  libraryId: number | null
  show: 'watched' | 'all'
  limit: number
}) =>
  queryOptions({
    queryKey: queryKeys.history({ libraryId, show, limit }),
    queryFn:
      libraryId == null
        ? skipToken
        : () => api.listHistory({ libraryId, limit, watchedOnly: show === 'watched' }),
    placeholderData: keepPreviousData,
  })

export const inProgressQuery = (libraryId: number) =>
  queryOptions({
    queryKey: queryKeys.inProgress(libraryId),
    queryFn: () => api.listInProgress(libraryId),
  })

export const libraryFavouritesQuery = (libraryId: number) =>
  queryOptions({
    queryKey: queryKeys.libraryFavourites(libraryId),
    queryFn: () => api.listLibraryFavourites(libraryId),
  })

export const sagasQuery = (libraryId: number | null) =>
  queryOptions({
    queryKey: queryKeys.sagas(libraryId),
    queryFn: libraryId == null ? skipToken : () => api.listSagas(libraryId),
  })

export const unmatchedQuery = (libraryId: number) =>
  queryOptions({
    queryKey: queryKeys.unmatched(libraryId),
    queryFn: () => api.listUnmatched(libraryId),
  })

export const duplicatesQuery = (libraryId: number) =>
  queryOptions({
    queryKey: queryKeys.duplicates(libraryId),
    queryFn: () => api.listDuplicates(libraryId),
  })

export const favouritesQuery = queryOptions({
  queryKey: queryKeys.favourites,
  queryFn: () => api.listFavourites(),
})

export const homeQuery = queryOptions({
  queryKey: queryKeys.home,
  queryFn: () => api.getHome(),
})

/** What a search from home finds in every library; a blank one asks for nothing. */
export const homeSearchQuery = (query: string) =>
  queryOptions({
    queryKey: queryKeys.homeSearch(query),
    queryFn: query === '' ? skipToken : () => api.searchHome(query),
    placeholderData: keepPreviousData,
  })

export const mediaQuery = (id: number | null) =>
  queryOptions({
    queryKey: queryKeys.mediaItem(id),
    queryFn: id == null ? skipToken : () => api.getMedia(id),
  })

/** A file's tracks only change when the file does, and the scan stores them. */
export const tracksQuery = playerQueriesFor(api).tracks

/** Where a file lives is read fresh each time its menu shows it. */
export const mediaLocationQuery = (id: number) =>
  queryOptions({
    queryKey: queryKeys.mediaLocation(id),
    queryFn: () => api.getMediaLocation(id),
    staleTime: 0,
  })

/** One window of a subtitle track; fetched windows stay for seeking back. */
export const subtitlesQuery = playerQueriesFor(api).subtitles

export const itemQuery = (id: number | null) =>
  queryOptions({
    queryKey: queryKeys.item(id),
    queryFn: id == null ? skipToken : () => api.getItem(id),
  })

export const itemImagesQuery = (id: number) =>
  queryOptions({
    queryKey: queryKeys.itemImages(id),
    queryFn: () => api.getItemImages(id),
  })

export const itemMetadataQuery = (id: number) =>
  queryOptions({
    queryKey: queryKeys.itemMetadata(id),
    queryFn: () => api.getItemMetadata(id),
  })

export const nextEpisodeQuery = (showId: number) =>
  queryOptions({
    queryKey: queryKeys.nextEpisode(showId),
    queryFn: () => api.nextEpisode(showId),
  })

export const personQuery = (id: number | null) =>
  queryOptions({
    queryKey: queryKeys.person(id),
    queryFn: id == null ? skipToken : () => api.getPerson(id),
  })

/** A search for Fix match, scored against `subject` and best first; an empty title asks for nothing. */
export const matchSearchQuery = ({
  type,
  query,
  year,
  libraryId,
  subject,
}: {
  type: MatchItemType
  query: string
  year: number | null
  libraryId: number | null
  subject: MatchSubject | null
}) =>
  queryOptions({
    queryKey: queryKeys.matchSearch({ type, query, year, libraryId, subject }),
    queryFn:
      query === '' ? skipToken : () => api.searchMatches({ type, query, year, libraryId, subject }),
    staleTime: 5 * 60_000,
  })

export const browseQuery = (path: string | null) =>
  queryOptions({
    queryKey: queryKeys.browse(path),
    queryFn: () => api.browse(path ?? undefined),
  })

export const lockQuery = queryOptions({ queryKey: queryKeys.lock, queryFn: () => api.getLock() })

/** A moment past when a lock on its way is due, so the server holds it by the time it is asked. */
const PAST_DUE_MS = 250

/** Read again once a lock on its way holds, so every page can follow it. */
export const adminLockQuery = queryOptions({
  queryKey: queryKeys.adminLock,
  queryFn: () => api.getAdminLock(),
  staleTime: 60_000,
  refetchInterval: (query) => {
    const lock = query.state.data
    return lock?.state === 'turningOn' ? lock.remainingMs + PAST_DUE_MS : false
  },
})

export const metadataHealthQuery = queryOptions({
  queryKey: queryKeys.metadataHealth,
  queryFn: () => api.getMetadataHealth(),
  staleTime: 60_000,
})

export const playbackSettingsQuery = playerQueriesFor(api).playbackSettings

export const displaySettingsQuery = queryOptions({
  queryKey: queryKeys.displaySettings,
  queryFn: () => api.getDisplaySettings(),
  staleTime: 60_000,
})
