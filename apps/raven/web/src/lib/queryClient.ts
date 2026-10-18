import { playerQueryKeys } from '@raven/ui'
import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'
import {
  type MatchItemType,
  type MatchSubject,
  type MediaSort,
  ApiError,
  isLockedError,
} from '@raven/core'
import { useUnlockPrompt } from '@/stores/unlockPrompt'

/** Anything refused for sitting in a locked library asks for the PIN, wherever it was asked for. */
const askForPin = (error: Error): void => {
  if (isLockedError(error)) useUnlockPrompt.getState().ask()
}

export const createQueryClient = (): QueryClient =>
  new QueryClient({
    queryCache: new QueryCache({ onError: askForPin }),
    mutationCache: new MutationCache({ onError: askForPin }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: true,
        // A 404 will not fix itself; anything else gets one more try.
        retry: (failures, error) =>
          !(error instanceof ApiError && error.status === 404) && failures < 1,
      },
    },
  })

/**
 * Every cache key, in one place. An id may be null for a query that waits on
 * it (`skipToken`); the key still names what it would hold.
 */
export const queryKeys = {
  ...playerQueryKeys,
  libraries: ['libraries'],
  library: (id: number | null) => ['libraries', id],
  media: ({
    libraryId,
    search,
    sort,
    seed,
  }: {
    libraryId: number
    search: string
    sort: MediaSort
    seed: number
  }) => ['libraries', libraryId, 'media', { search, sort, seed }],
  /** The prefix every media list of a library shares, whatever its search and sort. */
  mediaLists: (libraryId: number) => ['libraries', libraryId, 'media'],
  shows: ({
    libraryId,
    search,
    sort,
    seed,
  }: {
    libraryId: number
    search: string
    sort: MediaSort
    seed: number
  }) => ['libraries', libraryId, 'shows', { search, sort, seed }],
  /** The prefix a library's show listings share. */
  showLists: (libraryId: number) => ['libraries', libraryId, 'shows'],
  /** Every video's own queries: the item, its tracks, subtitles and location. */
  allMedia: ['media'],
  mediaItem: (id: number | null) => ['media', id],
  /** Where a video's file lives, for its menu. */
  mediaLocation: (id: number) => ['media', id, 'location'],
  favourites: ['favourites'],
  favouriteTitles: ['favourites', 'titles'],
  /** What is in progress and each pinned library's newest arrivals. */
  home: ['home'],
  /** A search from home, under home's key so whatever reads home again reads it again too. */
  homeSearch: (query: string) => ['home', 'search', query],
  homeSearches: ['home', 'search'],
  history: ({
    libraryId,
    show,
    limit,
  }: {
    libraryId: number | null
    show: string
    limit: number
  }) => ['libraries', libraryId, 'history', { show, limit }],
  /** The prefix every history of a library, or of all of them, shares. */
  historyLists: (libraryId: number | null) => ['libraries', libraryId, 'history'],
  /** A library's tabs beside its listing: in progress, favourites, sagas, files not matched. */
  inProgress: (libraryId: number) => ['libraries', libraryId, 'in-progress'],
  libraryFavourites: (libraryId: number) => ['libraries', libraryId, 'favourites'],
  sagas: (libraryId: number | null) => ['libraries', libraryId, 'sagas'],
  unmatched: (libraryId: number) => ['libraries', libraryId, 'unmatched'],
  duplicates: (libraryId: number) => ['libraries', libraryId, 'duplicates'],
  browse: (path: string | null) => ['browse', path],
  /** Every item page shares this prefix, so a match or refresh refetches them all. */
  items: ['items'],
  item: (id: number | null) => ['items', id],
  /** Edit images: what an item could show. */
  itemImages: (id: number) => ['items', id, 'images'],
  /** Edit metadata: what the page shows against what TMDB says. */
  itemMetadata: (id: number) => ['items', id, 'metadata'],
  /** Whether locked libraries can be opened, and are, in this browser. */
  lock: ['lock'],
  /** Whether the admin lock holds in this browser. */
  adminLock: ['admin'],
  displaySettings: ['settings', 'display'],
  nextEpisode: (showId: number) => ['items', showId, 'next'],
  person: (id: number | null) => ['people', id],
  matchSearch: ({
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
  }) => ['match', type, query, year, libraryId, subject?.kind ?? null, subject?.id ?? null],
  metadataHealth: ['health', 'metadata'],
}

/**
 * Keys for the changes shown before the server answers. Changes under one
 * key go to the server one at a time and are read again together, so it
 * covers every change that reads again the same caches.
 */
export const mutationKeys = {
  /** Any video's favourite: they all show in the same listings. */
  favourite: ['favourite'],
  /** Any show's or season's favourite: they all show on Favourites. */
  itemFavourite: ['item-favourite'],
  /** Any mark as watched or unwatched: marks and their answers keep their order. */
  watched: ['watched'],
  /** Any library's pin: they all show in the libraries list and on home. */
  pin: ['pin'],
  /** One library's sort, view or grouping, which only its page changes. */
  libraryView: (libraryId: number) => ['library-view', libraryId],
  playbackSettings: ['settings', 'playback'],
  displaySettings: ['settings', 'display'],
}
