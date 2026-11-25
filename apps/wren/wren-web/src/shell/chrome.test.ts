import { describe, expect, it } from 'bun:test'
import {
  COLLECTION_KINDS,
  WREN_ROUTES,
  albumPath,
  artistPath,
  collectionPath,
  playlistPath,
} from '@/routes'
import { CHROMES, chromeOf } from '@/shell/chrome'

describe('chromeOf', () => {
  it.each([WREN_ROUTES.signIn, WREN_ROUTES.nowPlaying])('draws %s alone', (pathname) => {
    expect(chromeOf({ pathname })).toBe(CHROMES.bare)
  })

  it.each([WREN_ROUTES.home, WREN_ROUTES.library, WREN_ROUTES.search, WREN_ROUTES.settings])(
    'gives the tab %s the tab bar',
    (pathname) => {
      expect(chromeOf({ pathname })).toBe(CHROMES.tabs)
    },
  )

  it.each([albumPath(7), artistPath(1), playlistPath(4), collectionPath(COLLECTION_KINDS.songs)])(
    'reads %s as a page opened from a tab',
    (pathname) => {
      expect(chromeOf({ pathname })).toBe(CHROMES.page)
    },
  )

  it('reads a path the same with a slash at its end', () => {
    expect(chromeOf({ pathname: `${WREN_ROUTES.library}/` })).toBe(CHROMES.tabs)
    expect(chromeOf({ pathname: `${WREN_ROUTES.signIn}/` })).toBe(CHROMES.bare)
  })
})
