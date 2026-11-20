import {
  REQUEST_STATUSES,
  type RequestStatus,
  type TitleHolding,
  type TitleRequest,
  type TitleRequestAsk,
  type TitleRequests,
  requestKeyOf,
} from '@/contract/requests'

/** A request a scan has added to a library, which its card opens there. */
export type LibraryRequest = TitleRequest & { libraryItemId: number }

export const isLibraryRequest = (request: TitleRequest): request is LibraryRequest =>
  typeof request.libraryItemId === 'number'

/** Whether a request is fulfilled: a library holds it, or its download is whole and on its way into one. */
const isAddedRequest = (request: TitleRequest): boolean =>
  isLibraryRequest(request) || request.status === REQUEST_STATUSES.downloaded

/** The caller's own requests, newest first as the server lists them; none while the list is read. */
export const myRequestsOf = (list: TitleRequests | undefined): TitleRequest[] =>
  list?.requests.filter((request) => request.isMine) ?? []

/*
 * Every title on its way for the caller: their own requests, and the titles
 * still to come that an arr holds without anyone asking, which every account
 * sees. So whatever a title's page calls requested shows in one of the two
 * lists below, unless it was another account's request.
 */
const requestedFor = (list: TitleRequests | undefined): TitleRequest[] =>
  list?.requests.filter((request) => request.isMine || !!request.isHeld) ?? []

/** The titles on their way for the caller that are not fulfilled yet. */
export const pendingRequestsOf = (list: TitleRequests | undefined): TitleRequest[] =>
  requestedFor(list).filter((request) => !isAddedRequest(request))

/** The titles on their way for the caller that are fulfilled: in a library, or downloaded and moving into one. */
export const addedRequestsOf = (list: TitleRequests | undefined): TitleRequest[] =>
  requestedFor(list).filter(isAddedRequest)

type RequestOfProps = { list: TitleRequests | undefined; ask: TitleRequestAsk }

/** The request for a title, or null while nobody has made one (or the list is still read). */
export const requestOf = ({ list, ask }: RequestOfProps): TitleRequest | null =>
  list?.requests.find((request) => requestKeyOf(request) === requestKeyOf(ask)) ?? null

/** Where a requested title stands, and raven's request for it: null while only its arr holds it. */
export type RequestStanding = { status: RequestStatus; request: TitleRequest | null }

type RequestStandingOfProps = RequestOfProps & { holding: TitleHolding | undefined }

/** raven's request for the title, else its arr's holding of it; null while it is free to request. */
export const requestStandingOf = ({
  list,
  ask,
  holding,
}: RequestStandingOfProps): RequestStanding | null => {
  const request = requestOf({ list, ask })
  if (request !== null) return { status: request.status, request }
  const held = holding?.status ?? null
  return held === null ? null : { status: held, request: null }
}

/** What a title's request control shows: nothing yet, requests off, where the title stands, the budget spent, or the button. */
export const REQUEST_STATES = {
  loading: 'loading',
  off: 'off',
  requested: 'requested',
  spent: 'spent',
  open: 'open',
} as const

export type RequestState = (typeof REQUEST_STATES)[keyof typeof REQUEST_STATES]

type RequestStateOfProps = RequestOfProps & {
  standing: RequestStanding | null
  /** Whether the title's arr is still being asked. */
  isReading: boolean
}

/** Which state the control is in, from the requests and the title's arr as the server last answered them. */
export const requestStateOf = ({
  ask,
  list,
  standing,
  isReading,
}: RequestStateOfProps): RequestState => {
  if (list === undefined || isReading) return REQUEST_STATES.loading
  if (standing !== null) return REQUEST_STATES.requested
  if (!list.kinds[ask.type]) return REQUEST_STATES.off
  if (list.budget.left === 0) return REQUEST_STATES.spent
  return REQUEST_STATES.open
}
