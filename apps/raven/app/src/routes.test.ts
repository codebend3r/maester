import { describe, expect, it } from 'bun:test'

import { APP_ROUTES, APP_ROUTE_PARAMS, ROUTE_TARGETS, hrefOf } from '@/routes'

describe('hrefOf', () => {
  it("opens an item's page, naming its library and file only when it has them", () => {
    expect(hrefOf({ kind: ROUTE_TARGETS.item, itemId: 40, libraryId: null, fileId: null })).toEqual(
      { pathname: APP_ROUTES.item, params: { [APP_ROUTE_PARAMS.id]: '40' } },
    )
    expect(hrefOf({ kind: ROUTE_TARGETS.item, itemId: 40, libraryId: 1, fileId: 20 })).toEqual({
      pathname: APP_ROUTES.item,
      params: {
        [APP_ROUTE_PARAMS.id]: '40',
        [APP_ROUTE_PARAMS.library]: '1',
        [APP_ROUTE_PARAMS.file]: '20',
      },
    })
  })

  it('plays a file', () => {
    expect(hrefOf({ kind: ROUTE_TARGETS.play, mediaId: 20 })).toEqual({
      pathname: APP_ROUTES.play,
      params: { [APP_ROUTE_PARAMS.mediaId]: '20' },
    })
  })

  it('opens a library, on a search only when it is handed one', () => {
    expect(hrefOf({ kind: ROUTE_TARGETS.library, libraryId: 2, query: '' })).toEqual({
      pathname: APP_ROUTES.library,
      params: { [APP_ROUTE_PARAMS.id]: '2' },
    })
    expect(hrefOf({ kind: ROUTE_TARGETS.library, libraryId: 2, query: 'dune' })).toEqual({
      pathname: APP_ROUTES.library,
      params: { [APP_ROUTE_PARAMS.id]: '2', [APP_ROUTE_PARAMS.query]: 'dune' },
    })
  })
})
