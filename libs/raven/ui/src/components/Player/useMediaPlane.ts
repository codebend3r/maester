import type { ApiClient, MediaAccess } from '@raven/core'
import { useQuery } from '@tanstack/react-query'
import { useCallback, useMemo, useRef } from 'react'
import { MEDIA_PLANE_COPY } from '@/components/Player/copy'
import { playerQueriesFor } from '@/lib/playerQueries'
import { useMediaOrigin } from '@/stores/mediaOrigin'
import { useToasts } from '@/stores/toasts'

/** Where one video's media comes from, and what the player does when that fails. */
export type MediaPlane = {
  /** Null when the host names no origin (the player plays through the web host's own address), or while the ticket is on its way. */
  access: MediaAccess | null
  /** Whether the host names an origin whose ticket has not come yet: nothing plays until it does, never through the web host. */
  isAwaitingTicket: boolean
  /** Fetches a new ticket now; false when the server would not give one. */
  refreshTicket: () => Promise<boolean>
  /** The origin could not be reached: says so once, in a toast naming its host. */
  reportUnreachable: () => void
}

type UseMediaPlaneProps = {
  api: ApiClient
  mediaId: number
  /** Whether there is a video to play yet; false asks for no ticket. */
  isEnabled?: boolean
}

export const useMediaPlane = ({
  api,
  mediaId,
  isEnabled = true,
}: UseMediaPlaneProps): MediaPlane => {
  const origin = useMediaOrigin((state) => state.pick?.origin ?? null)
  const ticket = useQuery({
    ...playerQueriesFor(api).mediaTicket(mediaId),
    enabled: origin !== null && isEnabled,
  })
  const kind = origin?.kind ?? null
  const url = origin?.url ?? null
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
  const showToast = useToasts((state) => state.show)
  const hasToasted = useRef(false)
  const reportUnreachable = useCallback(() => {
    if (url === null || hasToasted.current) return
    hasToasted.current = true
    showToast(MEDIA_PLANE_COPY.unreachable(new URL(url).host))
  }, [url, showToast])
  return {
    access,
    isAwaitingTicket: origin !== null && access === null,
    refreshTicket,
    reportUnreachable,
  }
}
