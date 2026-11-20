import { MEMBER_STATUSES } from '@raven/core'
import { useQuery } from '@tanstack/react-query'

import { useAccountSession } from '@/account/session'
import type { AppQueries } from '@/queries/useAppQueries'

/**
 * The signed-in account's id once `GET /api/me` says it is the approved owner, else null: what
 * shows the owner's own controls, Settings' Admin sections and a library card's buttons. The
 * server stays the authority on each call.
 */
export const useOwnerId = ({ queries }: AppQueries): string | null => {
  const userId = useAccountSession((state) => state.session?.userId ?? null)
  const { data: account } = useQuery(queries.accountQuery(userId))
  const isOwner = !!account?.isOwner && account.status === MEMBER_STATUSES.approved
  return isOwner ? account.id : null
}
