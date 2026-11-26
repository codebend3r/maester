import { describe, expect, it } from 'bun:test'

import { HOME_COPY, LIBRARY_PAGE_COPY, SEARCH_COPY, SETTINGS_COPY } from '@raven/wren'

import { WREN_ROUTES } from '@raven/wren-native/headless'
import { PLACES, placeOf } from '@/shell/places'

describe("the sidebar's places", () => {
  it("are the phone's four tabs, in the tab bar's order and words", () => {
    expect(PLACES.map(({ title }) => title)).toEqual([
      HOME_COPY.title,
      LIBRARY_PAGE_COPY.title,
      SEARCH_COPY.title,
      SETTINGS_COPY.title,
    ])
  })

  it('marks Home only at the root', () => {
    expect(placeOf({ pathname: WREN_ROUTES.home })?.route).toBe(WREN_ROUTES.home)
    expect(placeOf({ pathname: '/album/7' })).toBeNull()
  })

  it('marks the place a path is under', () => {
    expect(placeOf({ pathname: WREN_ROUTES.search })?.route).toBe(WREN_ROUTES.search)
    expect(placeOf({ pathname: WREN_ROUTES.settings })?.route).toBe(WREN_ROUTES.settings)
  })
})
