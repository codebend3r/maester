import { queryOptions } from '@tanstack/react-query'
import { type ApiClient, MEDIA_TICKET_REFRESH_SECONDS, MEDIA_TICKET_SECONDS } from '@raven/core'
import { playerQueryKeys as queryKeys } from '@/lib/playerQueryKeys'

export const playerQueriesFor = (api: ApiClient) => ({
  tracks: (id: number) =>
    queryOptions({
      queryKey: queryKeys.mediaTracks(id),
      queryFn: () => api.getTracks(id),
      staleTime: Infinity,
      retry: false,
    }),
  /** Probed afresh by the server on each fetch, so fetched once per file. */
  streams: (id: number) =>
    queryOptions({
      queryKey: queryKeys.mediaStreams(id),
      queryFn: () => api.getStreams(id),
      staleTime: Infinity,
      retry: false,
    }),
  /**
   * Refetched on a timer counted from receipt, not from `expiresAt`, so a skewed
   * browser clock cannot leave the player holding an expired ticket.
   */
  mediaTicket: (id: number) =>
    queryOptions({
      queryKey: queryKeys.mediaTicket(id),
      queryFn: () => api.getMediaTicket(id),
      staleTime: Infinity,
      retry: false,
      refetchInterval: (MEDIA_TICKET_SECONDS - MEDIA_TICKET_REFRESH_SECONDS) * 1000,
      refetchIntervalInBackground: true,
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
