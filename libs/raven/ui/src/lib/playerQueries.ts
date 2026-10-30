import { type QueryStatus, queryOptions } from '@tanstack/react-query'
import { type ApiClient, TICKET_RENEW_MS, type TicketedOrigin } from '@raven/core'
import { playerQueryKeys as queryKeys } from '@/lib/playerQueryKeys'

/** How long a refused ticket waits before it is asked for again. */
const REFUSED_RETRY_MS = 60_000

const QUERY_STATUSES = { error: 'error' } as const satisfies Record<string, QueryStatus>

/** Keeps a ticket that is already due from being refetched in a tight loop. */
const MIN_REFRESH_WAIT_MS = 1000

/**
 * Reads the address and ticket a subtitle fetch takes, for a client with no cookie to send (the
 * device app); read per fetch, so a ticket is never stale. Null leaves the fetch on the cookie.
 */
export type SubtitleAccessReader = () => Promise<TicketedOrigin | null>

type PlayerQueriesForSubtitlesProps = {
  id: number
  trackId: string
  window: number
  readAccess?: SubtitleAccessReader
}

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
        // A refused fetch, the first included, is retried gently: a relocked library answers 423.
        if (query.state.status === QUERY_STATUSES.error) return REFUSED_RETRY_MS
        if (query.state.dataUpdatedAt === 0) return TICKET_RENEW_MS
        return Math.max(
          MIN_REFRESH_WAIT_MS,
          query.state.dataUpdatedAt + TICKET_RENEW_MS - Date.now(),
        )
      },
      refetchIntervalInBackground: true,
    }),
  subtitles: (input: PlayerQueriesForSubtitlesProps) =>
    queryOptions({
      queryKey: queryKeys.subtitles(input),
      queryFn: async () => {
        const { readAccess, ...asked } = input
        return api.getSubtitles({ ...asked, access: (await readAccess?.()) ?? null })
      },
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
