import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'
import { ApiError, isLockedError } from '@raven/core'
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

export const queryKeys = {
  libraries: ['libraries'],
  library: (id: number) => ['libraries', id],
  media: ({
    libraryId,
    search,
    sort,
    seed,
  }: {
    libraryId: number
    search: string
    sort: string
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
    sort: string
    seed: number
  }) => ['libraries', libraryId, 'shows', { search, sort, seed }],
  /** The prefix a library's show listings share. */
  showLists: (libraryId: number) => ['libraries', libraryId, 'shows'],
  mediaItem: (id: number) => ['media', id],
  mediaTracks: (id: number) => ['media', id, 'tracks'],
  /** Where a video's file lives, for its menu. */
  mediaLocation: (id: number) => ['media', id, 'location'],
  subtitles: ({ id, trackId, window }: { id: number; trackId: string; window: number }) => [
    'media',
    id,
    'subtitles',
    trackId,
    window,
  ],
  favourites: ['favourites'],
  history: ({ libraryId, show, limit }: { libraryId: number; show: string; limit: number }) => [
    'libraries',
    libraryId,
    'history',
    { show, limit },
  ],
  /** The prefix every page of a library's history shares. */
  histories: (libraryId: number) => ['libraries', libraryId, 'history'],
  browse: (path: string | null) => ['browse', path],
  /** Every item page shares this prefix, so a match or refresh refetches them all. */
  items: ['items'],
  item: (id: number) => ['items', id],
  /** Edit images: what an item could show. */
  itemImages: (id: number) => ['items', id, 'images'],
  /** Edit metadata: what the page shows against what TMDB says. */
  itemMetadata: (id: number) => ['items', id, 'metadata'],
  /** Whether locked libraries can be opened, and are, in this browser. */
  lock: ['lock'],
  /** How the server plays video, for every viewer. */
  playbackSettings: ['settings', 'playback'],
  nextEpisode: (showId: number) => ['items', showId, 'next'],
  person: (id: number) => ['people', id],
  matchSearch: ({ type, query, year }: { type: string; query: string; year: number | null }) => [
    'match',
    type,
    query,
    year,
  ],
  metadataHealth: ['health', 'metadata'],
}
