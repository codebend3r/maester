import { queryOptions } from '@tanstack/react-query'
import { type ApiClient, MEDIA_TICKET_REFRESH_SECONDS, MEDIA_TICKET_SECONDS } from '@raven/core'
import { playerQueryKeys as queryKeys } from '@/lib/playerQueryKeys'

const TICKET_REFRESH_MS = (MEDIA_TICKET_SECONDS - MEDIA_TICKET_REFRESH_SECONDS) * 1000

const REFUSED_RETRY_MS = 60_000

/** Keeps a ticket that is already due from being refetched in a tight loop. */
const MIN_REFRESH_WAIT_MS = 1000

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
   * Refetched a fixed time after the ticket arrived, not after `expiresAt` (a skewed
   * browser clock cannot leave the player holding an expired ticket), and not after
   * the last mount (a cached ticket keeps its age across a remount).
   */
  mediaTicket: (id: number) =>
    queryOptions({
      queryKey: queryKeys.mediaTicket(id),
      queryFn: () => api.getMediaTicket(id),
      staleTime: Infinity,
      retry: false,
      refetchInterval: (query) => {
        if (query.state.dataUpdatedAt === 0) return TICKET_REFRESH_MS
        // A refused refresh (a relocked library answers 423) is retried gently, not every second.
        if (query.state.status === 'error') return REFUSED_RETRY_MS
        return Math.max(
          MIN_REFRESH_WAIT_MS,
          query.state.dataUpdatedAt + TICKET_REFRESH_MS - Date.now(),
        )
      },
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
