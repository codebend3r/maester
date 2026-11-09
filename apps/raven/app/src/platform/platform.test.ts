import { describe, expect, it } from 'bun:test'

import { APP_PLATFORMS, NAV_KINDS, SYSTEMS, navKindOf, platformOf } from '@/platform/platform'

/** A system React Native runs on that the app is not built for. */
const UNBUILT_SYSTEMS = { web: 'web' } as const

describe('platformOf', () => {
  it('tells Apple TV from iPhone and iPad, which all report ios', () => {
    expect(platformOf({ os: SYSTEMS.ios, isTV: true })).toBe(APP_PLATFORMS.tvos)
    expect(platformOf({ os: SYSTEMS.ios, isTV: false })).toBe(APP_PLATFORMS.ios)
  })

  it('counts every Android build as Android TV, the only one the app ships', () => {
    expect(platformOf({ os: SYSTEMS.android, isTV: true })).toBe(APP_PLATFORMS.androidTv)
    expect(platformOf({ os: SYSTEMS.android, isTV: false })).toBe(APP_PLATFORMS.androidTv)
  })

  it('refuses a system the app is not built for', () => {
    expect(() => platformOf({ os: UNBUILT_SYSTEMS.web, isTV: false })).toThrow(
      `raven's app is not built for ${UNBUILT_SYSTEMS.web}`,
    )
  })
})

describe('navKindOf', () => {
  it('moves by focus on a TV, whatever else it says', () => {
    expect(navKindOf({ isTV: true, isPad: false })).toBe(NAV_KINDS.focus)
  })

  it('gives an iPhone the tab bar and an iPad the side menu', () => {
    expect(navKindOf({ isTV: false, isPad: false })).toBe(NAV_KINDS.tabs)
    expect(navKindOf({ isTV: false, isPad: true })).toBe(NAV_KINDS.drawer)
  })
})
