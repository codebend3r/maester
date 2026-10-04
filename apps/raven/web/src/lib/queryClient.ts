import { QueryClient } from '@tanstack/react-query'
import { ApiError } from '@raven/core'

export const createQueryClient = (): QueryClient =>
  new QueryClient({
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
  media: ({ libraryId, search, sort }: { libraryId: number; search: string; sort: string }) => [
    'libraries',
    libraryId,
    'media',
    { search, sort },
  ],
  /** The prefix every media list of a library shares, whatever its search and sort. */
  mediaLists: (libraryId: number) => ['libraries', libraryId, 'media'],
  mediaItem: (id: number) => ['media', id],
  favourites: ['favourites'],
  browse: (path: string | null) => ['browse', path],
}
