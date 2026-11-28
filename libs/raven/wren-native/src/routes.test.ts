import { describe, expect, it } from 'bun:test'
import { ALBUMS_ORDER_PARAM, LIBRARY_SEGMENTS, RECENT_KINDS, RECENT_SORTS } from '@raven/wren'

import {
  WREN_PAGES,
  WREN_ROUTE_PARAMS,
  albumsInOrderHref,
  libraryHref,
  recentPageHref,
} from '@/routes'

describe('recentPageHref', () => {
  it("opens a recent artist's page", () => {
    expect(recentPageHref({ kind: RECENT_KINDS.artist, id: 3, name: 'Sia' })).toEqual({
      pathname: WREN_PAGES.artist,
      params: { [WREN_ROUTE_PARAMS.id]: '3' },
    })
  })

  it("opens a recent album's page", () => {
    expect(
      recentPageHref({
        kind: RECENT_KINDS.album,
        id: 7,
        title: 'OK Computer',
        artists: 'Radiohead',
      }),
    ).toEqual({ pathname: WREN_PAGES.album, params: { [WREN_ROUTE_PARAMS.id]: '7' } })
  })
})

describe('albumsInOrderHref', () => {
  it("opens Albums with Home's order named", () => {
    expect(albumsInOrderHref({ sort: RECENT_SORTS.release })).toEqual({
      pathname: libraryHref(LIBRARY_SEGMENTS.albums).pathname,
      params: {
        [WREN_ROUTE_PARAMS.kind]: LIBRARY_SEGMENTS.albums,
        [ALBUMS_ORDER_PARAM]: RECENT_SORTS.release,
      },
    })
  })
})
