import { describe, expect, it } from 'bun:test'

import { APP_ROUTES, ROUTE_TARGETS, hrefOf } from '@/routes'

describe('hrefOf', () => {
  it("opens an item's page, naming its library and file only when it has them", () => {
    expect(hrefOf({ kind: ROUTE_TARGETS.item, itemId: 40, libraryId: null, fileId: null })).toEqual(
      { pathname: APP_ROUTES.item, params: { id: '40' } },
    )
    expect(hrefOf({ kind: ROUTE_TARGETS.item, itemId: 40, libraryId: 1, fileId: 20 })).toEqual({
      pathname: APP_ROUTES.item,
      params: { id: '40', library: '1', file: '20' },
    })
  })

  it('plays a file', () => {
    expect(hrefOf({ kind: ROUTE_TARGETS.play, mediaId: 20 })).toEqual({
      pathname: APP_ROUTES.play,
      params: { mediaId: '20' },
    })
  })
})
