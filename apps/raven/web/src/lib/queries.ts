import { keepPreviousData, queryOptions, skipToken } from '@tanstack/react-query'
import type { MatchItemType, MediaSort } from '@raven/core'
import { api } from '@/lib/api'
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

export const unmatchedQuery = (libraryId: number) =>
  queryOptions({
    queryKey: queryKeys.unmatched(libraryId),
    queryFn: () => api.listUnmatched(libraryId),
  })

export const favouritesQuery = queryOptions({
  queryKey: queryKeys.favourites,
  queryFn: () => api.listFavourites(),
})

export const homeQuery = queryOptions({
  queryKey: queryKeys.home,
  queryFn: () => api.getHome(),
})

export const mediaQuery = (id: number | null) =>
  queryOptions({
    queryKey: queryKeys.mediaItem(id),
    queryFn: id == null ? skipToken : () => api.getMedia(id),
  })

/** A file's tracks only change when the file does, and the scan stores them. */
export const tracksQuery = (id: number) =>
  queryOptions({
    queryKey: queryKeys.mediaTracks(id),
    queryFn: () => api.getTracks(id),
    staleTime: Infinity,
    retry: false,
  })

/** Where a file lives is read fresh each time its menu shows it. */
export const mediaLocationQuery = (id: number) =>
  queryOptions({
    queryKey: queryKeys.mediaLocation(id),
    queryFn: () => api.getMediaLocation(id),
    staleTime: 0,
  })

/** One window of a subtitle track; fetched windows stay for seeking back. */
export const subtitlesQuery = ({
  id,
  trackId,
  window,
}: {
  id: number
  trackId: string
  window: number
}) =>
  queryOptions({
    queryKey: queryKeys.subtitles({ id, trackId, window }),
    queryFn: () => api.getSubtitles({ id, trackId, window }),
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
    retry: 1,
  })

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

/** A search for Fix match; an empty title asks for nothing. */
export const matchSearchQuery = ({
  type,
  query,
  year,
}: {
  type: MatchItemType
  query: string
  year: number | null
}) =>
  queryOptions({
    queryKey: queryKeys.matchSearch({ type, query, year }),
    queryFn: query === '' ? skipToken : () => api.searchMatches({ type, query, year }),
    staleTime: 5 * 60_000,
  })

export const browseQuery = (path: string | null) =>
  queryOptions({
    queryKey: queryKeys.browse(path),
    queryFn: () => api.browse(path ?? undefined),
  })

export const lockQuery = queryOptions({ queryKey: queryKeys.lock, queryFn: () => api.getLock() })

export const metadataHealthQuery = queryOptions({
  queryKey: queryKeys.metadataHealth,
  queryFn: () => api.getMetadataHealth(),
  staleTime: 60_000,
})

export const playbackSettingsQuery = queryOptions({
  queryKey: queryKeys.playbackSettings,
  queryFn: () => api.getPlaybackSettings(),
  staleTime: 60_000,
})

export const displaySettingsQuery = queryOptions({
  queryKey: queryKeys.displaySettings,
  queryFn: () => api.getDisplaySettings(),
  staleTime: 60_000,
})
