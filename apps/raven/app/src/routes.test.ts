import { describe, expect, it } from 'bun:test'

import { APP_ROUTES, APP_ROUTE_PARAMS, ROUTE_TARGETS, hrefOf, secondsOf } from '@/routes'

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

  it('plays a file, from the spot Resume names', () => {
    expect(hrefOf({ kind: ROUTE_TARGETS.play, mediaId: 20, at: 0 })).toEqual({
      pathname: APP_ROUTES.play,
      params: { [APP_ROUTE_PARAMS.mediaId]: '20' },
    })
    expect(hrefOf({ kind: ROUTE_TARGETS.play, mediaId: 20, at: 3000.5 })).toEqual({
      pathname: APP_ROUTES.play,
      params: { [APP_ROUTE_PARAMS.mediaId]: '20', [APP_ROUTE_PARAMS.at]: '3000.5' },
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

describe('hrefOf for music', () => {
  it('opens an album and an artist by id', () => {
    expect(hrefOf({ kind: ROUTE_TARGETS.album, albumId: 7 })).toEqual({
      pathname: APP_ROUTES.album,
      params: { [APP_ROUTE_PARAMS.id]: '7' },
    })
    expect(hrefOf({ kind: ROUTE_TARGETS.artist, artistId: 3 })).toEqual({
      pathname: APP_ROUTES.artist,
      params: { [APP_ROUTE_PARAMS.id]: '3' },
    })
  })
})

describe('secondsOf', () => {
  it('reads a spot in seconds from a route param, and 0 for anything else', () => {
    expect(secondsOf('3000.5')).toBe(3000.5)
    expect(secondsOf(undefined)).toBe(0)
    expect(secondsOf(['12', '13'])).toBe(0)
    expect(secondsOf('-4')).toBe(0)
    expect(secondsOf('Infinity')).toBe(0)
    expect(secondsOf('soon')).toBe(0)
  })
})
