import { REQUEST_STATUSES, type TitleRequest, type TitleRequests } from '@/contract/requests'

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
