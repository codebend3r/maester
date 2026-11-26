import { describe, expect, it } from 'bun:test'

import { AUDIO_PLATFORMS } from '@raven/core'

import { SYSTEMS, audioPlatformOf } from '@/music/audioPlatform'

describe('audioPlatformOf', () => {
  it("decodes with Apple's player on Apple TV, which reports iOS", () => {
    expect(audioPlatformOf({ os: SYSTEMS.ios })).toBe(AUDIO_PLATFORMS.apple)
  })

  it("decodes with Android's player on Android TV", () => {
    expect(audioPlatformOf({ os: SYSTEMS.android })).toBe(AUDIO_PLATFORMS.android)
  })

  it('refuses a system Wren on TV is not built for', () => {
    expect(() => audioPlatformOf({ os: 'web' })).toThrow()
  })
})
