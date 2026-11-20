import {
  type MemberRequest,
  requestKeyOf,
  type TitleRequest,
  type TitleRequestAsk,
} from '@raven/core'
import { useQuery } from '@tanstack/react-query'
import { ACCESS_KINDS, useAccessState } from '@/lib/accessState'
import { useCanManage } from '@/lib/management'
import { everyonesRequestsQuery } from '@/lib/queries'
import { type AccountName, accountNamesOf, useAccounts } from '@/lib/useAccounts'
import { COMING_SOON_COPY } from '@/pages/ComingSoonPage/copy'
import { REQUEST_COPY } from '@/pages/ComingSoonPage/requestCopy'

type RequesterOfProps = {
  ask: TitleRequestAsk
  request: TitleRequest | null
  ownEmail: string | null
  everyone: readonly MemberRequest[] | undefined
  nameOf: AccountName
}

/**
 * Who asked for the title, by email where the viewer may know it: their own,
 * any account's for the owner (the one read of requests that names accounts),
 * the downloader's for a title it took on with nobody asking, else someone.
 */
const requesterOf = ({ ask, request, ownEmail, everyone, nameOf }: RequesterOfProps): string => {
  const downloader = COMING_SOON_COPY.everyone.downloaders[ask.type]
  if (request === null || !!request.isHeld) return downloader
  if (request.isMine) return ownEmail ?? REQUEST_COPY.you
  const key = requestKeyOf(ask)
  const listed = everyone?.find((entry) => requestKeyOf(entry) === key)
  if (listed === undefined) return REQUEST_COPY.someone
  return listed.requestedBy === null ? downloader : nameOf(listed.requestedBy)
}

type UseRequesterProps = { ask: TitleRequestAsk; request: TitleRequest | null }

/** Who asked for the title, as `requesterOf` names them. */
export const useRequester = ({ ask, request }: UseRequesterProps): string => {
  const access = useAccessState()
  const canManage = useCanManage()
  const { data: everyone } = useQuery({ ...everyonesRequestsQuery, enabled: canManage })
  const nameOf = accountNamesOf({
    accounts: useAccounts(),
    thisServer: COMING_SOON_COPY.everyone.thisServer,
  })
  const ownEmail = access.kind === ACCESS_KINDS.approved ? access.account.email : null
  return requesterOf({ ask, request, ownEmail, everyone, nameOf })
}
