import { describe, expect, it } from 'bun:test'

import { isDroppedBy } from '@/layouts/touchMenuKit'
import { TOUCH_TABS, activeTabOf } from '@/layouts/touchTabsKit'
import { APP_ROUTES } from '@/routes'

describe('activeTabOf', () => {
  it("lights the page's own tab", () => {
    expect(activeTabOf({ pathname: APP_ROUTES.home, isMoreOpen: false })).toBe(TOUCH_TABS.home)
    expect(activeTabOf({ pathname: APP_ROUTES.favourites, isMoreOpen: false })).toBe(
      TOUCH_TABS.favourites,
    )
    expect(activeTabOf({ pathname: APP_ROUTES.continueWatching, isMoreOpen: false })).toBe(
      TOUCH_TABS.continueWatching,
    )
  })

  it('lights Libraries on every library and on any one of them', () => {
    expect(activeTabOf({ pathname: APP_ROUTES.libraries, isMoreOpen: false })).toBe(
      TOUCH_TABS.libraries,
    )
    expect(activeTabOf({ pathname: '/library/3', isMoreOpen: false })).toBe(TOUCH_TABS.libraries)
  })

  it('lights More while its sheet is up, and on the pages only it opens', () => {
    expect(activeTabOf({ pathname: APP_ROUTES.home, isMoreOpen: true })).toBe(TOUCH_TABS.more)
    expect(activeTabOf({ pathname: APP_ROUTES.search, isMoreOpen: false })).toBe(TOUCH_TABS.more)
    expect(activeTabOf({ pathname: APP_ROUTES.settings, isMoreOpen: false })).toBe(TOUCH_TABS.more)
  })

  it('lights nothing on a page no tab opens', () => {
    expect(activeTabOf({ pathname: '/item/7', isMoreOpen: false })).toBeNull()
    expect(activeTabOf({ pathname: '/album/2', isMoreOpen: false })).toBeNull()
  })
})

describe('isDroppedBy', () => {
  it('shuts the sheet past 80 points down, or on a flick', () => {
    expect(isDroppedBy({ dy: 100, vy: 0 })).toBe(true)
    expect(isDroppedBy({ dy: 40, vy: 0.1 })).toBe(false)
    expect(isDroppedBy({ dy: 40, vy: 0.9 })).toBe(true)
  })
})
