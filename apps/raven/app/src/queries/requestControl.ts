import {
  type MemberRequest,
  REQUEST_STATES,
  type RequestState,
  type TitleHolding,
  type TitleRequest,
  type TitleRequestAsk,
  type TitleRequests,
  requestKeyOf,
  requestStandingOf,
  requestStateOf,
} from '@raven/core'

import { COMING_SOON_COPY } from '@/queries/comingSoonCopy'
import { present } from '@/queries/lines'
import { type AccountNames, dayOf, memberRequesterOf } from '@/queries/upcomingCards'

const timeFormat = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  hour: 'numeric',
  minute: '2-digit',
})

type RequesterOfProps = {
  ask: TitleRequestAsk
  request: TitleRequest | null
  ownEmail: string | null
  everyone: readonly MemberRequest[] | undefined
  names: AccountNames
}

/**
 * Who asked for the title, by email where the viewer may know it: their own, any account's for
 * the owner, the downloader's for a title it took on with nobody asking, else someone.
 */
const requesterOf = ({ ask, request, ownEmail, everyone, names }: RequesterOfProps): string => {
  const downloader = COMING_SOON_COPY.everyone.downloaders[ask.type]
  if (request === null || !!request.isHeld) return downloader
  if (request.isMine) return ownEmail ?? COMING_SOON_COPY.request.you
  const listed = everyone?.find((entry) => requestKeyOf(entry) === requestKeyOf(ask))
  if (listed === undefined) return COMING_SOON_COPY.request.someone
  return memberRequesterOf({ request: listed, names })
}

type RequestControlOfProps = Omit<RequesterOfProps, 'request'> & {
  list: TitleRequests | undefined
  holding: TitleHolding | undefined
  /** Whether the title's arr is still being asked. */
  isReading: boolean
  /** Why the last ask did not go through; null with none. */
  failure: string | null
}

/** The request button's state and the lines under it. */
export type RequestControl = { state: RequestState; notes: string[] }

/**
 * What the title's page shows of its request, the web's rules: nothing while the requests and
 * the title's arr are read; where it stands, what that means and who asked once it is requested
 * or held; that requests of its kind are off; the day's budget spent, and when the next comes
 * back; else the button, what is left today and what one request does.
 */
export const requestControlOf = ({
  ask,
  list,
  holding,
  isReading,
  failure,
  ...who
}: RequestControlOfProps): RequestControl => {
  const copy = COMING_SOON_COPY.request
  const standing = requestStandingOf({ list, ask, holding })
  const state = requestStateOf({ ask, list, standing, isReading })
  if (list === undefined || state === REQUEST_STATES.loading) return { state, notes: [] }
  if (standing !== null) {
    const status = COMING_SOON_COPY.statuses[standing.status]
    const requester = requesterOf({ ask, request: standing.request, ...who })
    return {
      state,
      notes: [
        `${status.label}: ${status.line}`,
        standing.request === null
          ? copy.requestedBy(requester)
          : copy.requestedByOn({ who: requester, day: dayOf(standing.request.requestedAt) }),
      ],
    }
  }
  if (state === REQUEST_STATES.off) return { state, notes: [copy.off[ask.type]] }
  if (state === REQUEST_STATES.spent) {
    return {
      state,
      notes: present([
        copy.spent(list.budget.limit),
        list.budget.nextAt === null
          ? null
          : copy.nextAt(timeFormat.format(new Date(list.budget.nextAt))),
      ]),
    }
  }
  return {
    state,
    notes: present([
      copy.left(list.budget),
      copy.explain,
      failure === null ? null : `${copy.failed} ${failure}`,
    ]),
  }
}
