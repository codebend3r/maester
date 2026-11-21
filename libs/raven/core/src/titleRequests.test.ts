import { describe, expect, it } from 'bun:test'
import { ITEM_TYPES } from '@/contract/items'
import {
  REQUEST_STATUSES,
  type TitleRequest,
  type TitleRequests,
  isTitleRequests,
} from '@/contract/requests'
import {
  REQUEST_STATES,
  addedRequestsOf,
  myRequestsOf,
  pendingRequestsOf,
  requestOf,
  requestStandingOf,
  requestStateOf,
} from '@/titleRequests'

type RequestProps = Pick<TitleRequest, 'tmdbId' | 'isMine' | 'libraryItemId'> &
  Partial<Pick<TitleRequest, 'isHeld' | 'status'>>

const request = ({
  tmdbId,
  isMine,
  libraryItemId,
  isHeld = false,
  status = REQUEST_STATUSES.searching,
}: RequestProps): TitleRequest => ({
  type: ITEM_TYPES.movie,
  tmdbId,
  title: `Film ${tmdbId}`,
  status,
  requestedAt: '2026-11-15T14:00:00.000Z',
  isMine,
  isHeld,
  libraryItemId,
})

const LIST: TitleRequests = {
  requests: [
    request({ tmdbId: '1', isMine: true, libraryItemId: null }),
    request({ tmdbId: '2', isMine: true, libraryItemId: 42 }),
    request({ tmdbId: '3', isMine: false, libraryItemId: null }),
    request({ tmdbId: '4', isMine: false, libraryItemId: 43 }),
  ],
  budget: { limit: 10, left: 8, nextAt: null },
  kinds: { movie: true, show: true },
}

const idsOf = (requests: readonly TitleRequest[]) => requests.map(({ tmdbId }) => tmdbId)

describe('title requests', () => {
  it('keeps only the caller’s own, none while the list is read', () => {
    expect(idsOf(myRequestsOf(LIST))).toEqual(['1', '2'])
    expect(myRequestsOf(undefined)).toEqual([])
  })

  it('splits the caller’s own into pending and added by whether a library holds them', () => {
    expect(idsOf(pendingRequestsOf(LIST))).toEqual(['1'])
    expect(addedRequestsOf(LIST).map(({ libraryItemId }) => libraryItemId)).toEqual([42])
  })

  it('counts a title its arr holds among everyone’s, though nobody asked for it', () => {
    const list = {
      ...LIST,
      requests: [
        ...LIST.requests,
        request({ tmdbId: '5', isMine: false, isHeld: true, libraryItemId: null }),
        request({ tmdbId: '6', isMine: false, isHeld: true, libraryItemId: 44 }),
      ],
    }
    expect(idsOf(pendingRequestsOf(list))).toEqual(['1', '5'])
    expect(idsOf(addedRequestsOf(list))).toEqual(['2', '6'])
    expect(idsOf(myRequestsOf(list))).toEqual(['1', '2'])
  })

  it('counts a download that is whole as added before a library holds it', () => {
    const list = {
      ...LIST,
      requests: [
        request({
          tmdbId: '7',
          isMine: true,
          libraryItemId: null,
          status: REQUEST_STATUSES.downloaded,
        }),
        request({
          tmdbId: '8',
          isMine: true,
          libraryItemId: null,
          status: REQUEST_STATUSES.downloading,
        }),
      ],
    }
    expect(idsOf(addedRequestsOf(list))).toEqual(['7'])
    expect(idsOf(pendingRequestsOf(list))).toEqual(['8'])
  })

  it('reads an older server’s list, which names no library item or held title, as all pending', () => {
    const older = {
      ...LIST,
      requests: LIST.requests.map(
        ({ libraryItemId: _libraryItemId, isHeld: _isHeld, ...kept }) => kept,
      ),
    }
    expect(isTitleRequests(older)).toBe(true)
    expect(idsOf(pendingRequestsOf(older))).toEqual(['1', '2'])
    expect(addedRequestsOf(older)).toEqual([])
  })
})

describe('a title’s request', () => {
  const asked = { type: ITEM_TYPES.movie, tmdbId: '1' } as const
  const free = { type: ITEM_TYPES.movie, tmdbId: '99' } as const

  it('finds the request by its type and TMDB id, none while the list is read', () => {
    expect(requestOf({ list: LIST, ask: asked })?.tmdbId).toBe('1')
    expect(requestOf({ list: LIST, ask: { type: ITEM_TYPES.show, tmdbId: '1' } })).toBeNull()
    expect(requestOf({ list: undefined, ask: asked })).toBeNull()
  })

  it('stands where raven’s request does, else where its arr holds it, else nowhere', () => {
    const holding = { status: REQUEST_STATUSES.downloading }
    expect(requestStandingOf({ list: LIST, ask: asked, holding })).toEqual({
      status: REQUEST_STATUSES.searching,
      request: LIST.requests[0] ?? null,
    })
    expect(requestStandingOf({ list: LIST, ask: free, holding })).toEqual({
      status: REQUEST_STATUSES.downloading,
      request: null,
    })
    expect(requestStandingOf({ list: LIST, ask: free, holding: { status: null } })).toBeNull()
    expect(requestStandingOf({ list: LIST, ask: free, holding: undefined })).toBeNull()
  })

  it('shows nothing while read, then the standing, requests off, the budget spent, or the button', () => {
    const standing = requestStandingOf({ list: LIST, ask: asked, holding: undefined })
    const stateOf = (props: Partial<Parameters<typeof requestStateOf>[0]>) =>
      requestStateOf({ ask: free, list: LIST, standing: null, isReading: false, ...props })
    expect(stateOf({ list: undefined })).toBe(REQUEST_STATES.loading)
    expect(stateOf({ isReading: true })).toBe(REQUEST_STATES.loading)
    expect(stateOf({ ask: asked, standing })).toBe(REQUEST_STATES.requested)
    expect(stateOf({ list: { ...LIST, kinds: { movie: false, show: true } } })).toBe(
      REQUEST_STATES.off,
    )
    expect(stateOf({ list: { ...LIST, budget: { ...LIST.budget, left: 0 } } })).toBe(
      REQUEST_STATES.spent,
    )
    expect(stateOf({})).toBe(REQUEST_STATES.open)
  })
})
