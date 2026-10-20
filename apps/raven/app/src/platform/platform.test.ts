import { describe, expect, it } from 'bun:test'

import { APP_PLATFORMS, SYSTEMS, platformOf } from '@/platform/platform'

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
    expect(() => platformOf({ os: 'web', isTV: false })).toThrow("raven's app is not built for web")
  })
})
