import { describe, expect, it } from 'bun:test'

import {
  APP_PLATFORMS,
  INPUT_KINDS,
  NAV_KINDS,
  PLATFORM_TRAITS,
  SYSTEMS,
  navKindOf,
  platformOf,
} from '@/platform/platform'

/** A system React Native runs on that the app is not built for. */
const UNBUILT_SYSTEMS = { web: 'web' } as const

describe('platformOf', () => {
  it('tells Apple TV from iPhone and iPad, which all report ios', () => {
    expect(platformOf({ os: SYSTEMS.ios, isTV: true })).toBe(APP_PLATFORMS.tvos)
    expect(platformOf({ os: SYSTEMS.ios, isTV: false })).toBe(APP_PLATFORMS.ios)
  })

  it('tells Android TV from an Android phone, which both report android', () => {
    expect(platformOf({ os: SYSTEMS.android, isTV: true })).toBe(APP_PLATFORMS.androidTv)
    expect(platformOf({ os: SYSTEMS.android, isTV: false })).toBe(APP_PLATFORMS.androidPhone)
  })

  it('refuses a system the app is not built for', () => {
    expect(() => platformOf({ os: UNBUILT_SYSTEMS.web, isTV: false })).toThrow(
      `raven's app is not built for ${UNBUILT_SYSTEMS.web}`,
    )
  })
})

describe('PLATFORM_TRAITS', () => {
  it("drives an Android phone by touch, as an iPhone, over the Android TV's ExoPlayer ways", () => {
    const phone = PLATFORM_TRAITS[APP_PLATFORMS.androidPhone]
    const tv = PLATFORM_TRAITS[APP_PLATFORMS.androidTv]
    expect(phone.input).toBe(INPUT_KINDS.touch)
    expect({ ...phone, input: tv.input }).toEqual(tv)
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
