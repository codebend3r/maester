import { useQueryClient } from '@tanstack/react-query'
import { playerQueryKeys } from '@raven/ui'
import { useEffect } from 'react'
import { onAccessTokenChange } from '@/stores/authSession'

/**
 * Mints the open title a new media ticket whenever the session's token is
 * refreshed. An account ticket lasts no longer than the token it was minted
 * with, and Supabase refreshes a token only in its last 90 seconds, so a
 * ticket minted late in a token's life can run out before the player's own
 * timer renews it, and the next seek or range would be refused. A disabled
 * ticket query, a player with no media origin to use it on, is left alone.
 */
export const useTicketFollowsSession = ({ mediaId }: { mediaId: number }): void => {
  const queryClient = useQueryClient()
  useEffect(
    () =>
      onAccessTokenChange((token) => {
        if (token === null) return
        queryClient
          .refetchQueries({ queryKey: playerQueryKeys.mediaTicket(mediaId) })
          .catch(() => undefined)
      }),
    [queryClient, mediaId],
  )
}
