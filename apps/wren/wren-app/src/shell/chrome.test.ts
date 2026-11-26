import { describe, expect, it } from 'bun:test'

import { WREN_SCREENS } from '@raven/wren-native/headless'
import { CHROMES, chromeOf } from '@/shell/chrome'
import { pageInsetsOf, toastOffsetOf } from '@/shell/pageInsets'
import { SHELL_SIZES, SIZE, SPACE, FORM_FACTORS } from '@/theme/wrenTokens'

const NOTCHED = { top: 59, bottom: 34, left: 0, right: 0 }

describe('chromeOf', () => {
  it('draws sign-in and Now Playing alone', () => {
    expect(chromeOf({ screen: WREN_SCREENS.signIn })).toBe(CHROMES.bare)
    expect(chromeOf({ screen: WREN_SCREENS.nowPlaying })).toBe(CHROMES.bare)
  })

  it('gives a tab the tab bar and anything else the page chrome', () => {
    expect(chromeOf({ screen: WREN_SCREENS.tabs })).toBe(CHROMES.tabs)
    expect(chromeOf({ screen: WREN_SCREENS.album })).toBe(CHROMES.page)
  })
})

describe('pageInsetsOf', () => {
  it('starts a phone page below the status bar, inside the gutter', () => {
    const insets = pageInsetsOf({
      safe: NOTCHED,
      formFactor: FORM_FACTORS.phone,
      chrome: CHROMES.tabs,
      hasPlayer: false,
    })
    expect(insets).toEqual({
      paddingTop: NOTCHED.top + SPACE.s2,
      paddingBottom: SPACE.s6,
      paddingLeft: SIZE.gutter,
      paddingRight: SIZE.gutter,
    })
  })

  it('clears the home indicator on a pushed page with nothing under it', () => {
    const insets = pageInsetsOf({
      safe: NOTCHED,
      formFactor: FORM_FACTORS.phone,
      chrome: CHROMES.page,
      hasPlayer: false,
    })
    expect(insets.paddingBottom).toBe(NOTCHED.bottom + SPACE.s6)
  })

  it('leaves the home indicator to the mini player when one is under the page', () => {
    const insets = pageInsetsOf({
      safe: NOTCHED,
      formFactor: FORM_FACTORS.phone,
      chrome: CHROMES.page,
      hasPlayer: true,
    })
    expect(insets.paddingBottom).toBe(SPACE.s6)
  })

  it("pads a tablet's content 36 at the top and 40 at the sides", () => {
    const insets = pageInsetsOf({
      safe: { ...NOTCHED, top: 24 },
      formFactor: FORM_FACTORS.tablet,
      chrome: CHROMES.tabs,
      hasPlayer: true,
    })
    expect(insets).toEqual({
      paddingTop: 24 + SHELL_SIZES.tabletPadTop,
      paddingBottom: SPACE.s10,
      paddingLeft: SHELL_SIZES.tabletPadSide,
      paddingRight: SHELL_SIZES.tabletPadSide,
    })
  })
})

describe('toastOffsetOf', () => {
  it('floats over the tab bar and the mini player on a phone tab', () => {
    expect(
      toastOffsetOf({
        formFactor: FORM_FACTORS.phone,
        chrome: CHROMES.tabs,
        hasPlayer: true,
        safeBottom: 34,
      }),
    ).toBe(SIZE.tabBar + SIZE.miniPlayer + SPACE.s2 + SPACE.s4)
  })

  it('clears only the home indicator on a pushed page with nothing queued', () => {
    expect(
      toastOffsetOf({
        formFactor: FORM_FACTORS.phone,
        chrome: CHROMES.page,
        hasPlayer: false,
        safeBottom: 34,
      }),
    ).toBe(34 + SPACE.s4)
  })

  it("clears the tablet's player bar while a track is queued, and nothing on Now Playing", () => {
    expect(
      toastOffsetOf({
        formFactor: FORM_FACTORS.tablet,
        chrome: CHROMES.tabs,
        hasPlayer: true,
        safeBottom: 20,
      }),
    ).toBe(SHELL_SIZES.tabletPlayerBar + 20 + SPACE.s4)
    expect(
      toastOffsetOf({
        formFactor: FORM_FACTORS.tablet,
        chrome: CHROMES.bare,
        hasPlayer: true,
        safeBottom: 20,
      }),
    ).toBe(20 + SPACE.s4)
  })
})
