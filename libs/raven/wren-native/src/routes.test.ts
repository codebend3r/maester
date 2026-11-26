import { describe, expect, it } from 'bun:test'
import { RECENT_KINDS } from '@raven/wren'

import { WREN_PAGES, WREN_ROUTE_PARAMS, recentPageHref } from '@/routes'

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
