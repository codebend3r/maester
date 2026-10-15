import { queryOptions } from '@tanstack/react-query'
import type { ApiClient } from '@raven/core'
import { queryKeys } from '@/lib/queryClient'

export const playerQueriesFor = (api: ApiClient) => ({
  tracks: (id: number) =>
    queryOptions({
      queryKey: queryKeys.mediaTracks(id),
      queryFn: () => api.getTracks(id),
      staleTime: Infinity,
      retry: false,
    }),
  subtitles: (input: { id: number; trackId: string; window: number }) =>
    queryOptions({
      queryKey: queryKeys.subtitles(input),
      queryFn: () => api.getSubtitles(input),
      staleTime: Infinity,
      gcTime: 30 * 60 * 1000,
      retry: 1,
    }),
  playbackSettings: queryOptions({
    queryKey: queryKeys.playbackSettings,
    queryFn: () => api.getPlaybackSettings(),
    staleTime: 60_000,
  }),
})
