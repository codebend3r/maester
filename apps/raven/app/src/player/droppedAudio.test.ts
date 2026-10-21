import { describe, expect, it } from 'bun:test'
import { PLAYBACK_MODES } from '@raven/core'

import { APP_PLATFORMS } from '@/platform/platform'
import { hasAskedPick, isAudioDropped } from '@/player/droppedAudio'

/** A TrueHD track ExoPlayer listed but could neither decode nor pass through. */
const DROPPED = [{ index: 0, selected: false }]

const ON_TV = {
  platform: APP_PLATFORMS.androidTv,
  mode: PLAYBACK_MODES.direct,
  place: 0,
  reported: DROPPED,
}

describe('isAudioDropped', () => {
  it("hears a direct play on Android TV whose player picked none of the file's audio", () => {
    expect(isAudioDropped(ON_TV)).toBe(true)
  })

  it('hears one whose player played another track than the one asked for', () => {
    const reported = [
      { index: 0, selected: false },
      { index: 1, selected: true },
    ]
    expect(isAudioDropped({ ...ON_TV, reported })).toBe(true)
    expect(isAudioDropped({ ...ON_TV, reported, place: 1 })).toBe(false)
  })

  it('lets a direct play go whose player picked the track asked for', () => {
    expect(isAudioDropped({ ...ON_TV, reported: [{ index: 0, selected: true }] })).toBe(false)
  })

  it('lets a stream go, which carries the one track the session asked the server for', () => {
    expect(isAudioDropped({ ...ON_TV, mode: PLAYBACK_MODES.remux })).toBe(false)
  })

  it('takes any track where the player was left to choose', () => {
    expect(isAudioDropped({ ...ON_TV, place: null })).toBe(true)
    expect(
      isAudioDropped({
        ...ON_TV,
        place: null,
        reported: [
          { index: 0, selected: false },
          { index: 1, selected: true },
        ],
      }),
    ).toBe(false)
  })

  it('lets a player that lists no audio go', () => {
    expect(isAudioDropped({ ...ON_TV, reported: [] })).toBe(false)
  })

  it("leaves Apple's players alone, whose table names only audio they decode", () => {
    expect(isAudioDropped({ ...ON_TV, platform: APP_PLATFORMS.tvos })).toBe(false)
    expect(isAudioDropped({ ...ON_TV, platform: APP_PLATFORMS.ios })).toBe(false)
  })
})

describe('hasAskedPick', () => {
  it('hears the asked track picked at its place', () => {
    expect(
      hasAskedPick({
        place: 1,
        reported: [
          { index: 0, selected: false },
          { index: 1, selected: true },
        ],
      }),
    ).toBe(true)
  })

  it("hears another pick as not yet the asked one, ExoPlayer's first before it applies the ask", () => {
    expect(
      hasAskedPick({
        place: 1,
        reported: [
          { index: 0, selected: true },
          { index: 1, selected: false },
        ],
      }),
    ).toBe(false)
  })

  it('takes any pick where the player was left to choose', () => {
    expect(hasAskedPick({ place: null, reported: DROPPED })).toBe(true)
  })
})
