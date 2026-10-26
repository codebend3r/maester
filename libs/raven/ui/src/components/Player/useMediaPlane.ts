import type { ApiClient, MediaAccess } from '@raven/core'
import { useQuery } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'
import { playerQueriesFor } from '@/lib/playerQueries'
import { useMediaOrigin } from '@/stores/mediaOrigin'

/** Where one video's media comes from, and what the player does when that fails. */
export type MediaPlane = {
  /** Null while there is no origin or ticket yet: the player plays through the web host's own address. */
  access: MediaAccess | null
  /** Fetches a new ticket now; false when the server would not give one. */
  refreshTicket: () => Promise<boolean>
  /** The origin could not be reached: probe the origins again. */
  reportUnreachable: () => void
}

type UseMediaPlaneProps = {
  api: ApiClient
  mediaId: number
  reprobe: () => void
}

export const useMediaPlane = ({ api, mediaId, reprobe }: UseMediaPlaneProps): MediaPlane => {
  const pick = useMediaOrigin((state) => state.pick)
  const ticket = useQuery({
    ...playerQueriesFor(api).mediaTicket(mediaId),
    enabled: pick !== null,
  })
  const kind = pick?.origin.kind ?? null
  const url = pick?.origin.url ?? null
  const ticketValue = ticket.data?.ticket ?? null
  const access = useMemo<MediaAccess | null>(
    () => (kind && url && ticketValue ? { origin: { kind, url }, ticket: ticketValue } : null),
    [kind, url, ticketValue],
  )
  const { refetch } = ticket
  const refreshTicket = useCallback(async () => {
    const result = await refetch()
    return result.isSuccess
  }, [refetch])
  return { access, refreshTicket, reportUnreachable: reprobe }
}
