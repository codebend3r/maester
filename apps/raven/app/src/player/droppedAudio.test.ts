import { describe, expect, it } from 'bun:test'
import { PLAYBACK_MODES } from '@raven/core'

import { APP_PLATFORMS } from '@/platform/platform'
import {
  AUDIO_HEARINGS,
  AUDIO_SETTLE_SECONDS,
  type AudioHearing,
  type HeardAudio,
  hearAudio,
  isAudioDropped,
} from '@/player/droppedAudio'

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

/** The film's two tracks, as ExoPlayer lists them with the one at `picked` playing. */
const pickedAt = (picked: number) => [
  { index: 0, selected: picked === 0 },
  { index: 1, selected: picked === 1 },
]

const ATTEMPT = 1

/** Hears each in turn from nothing, and gives what was heard last and every report judged. */
const hearAll = (hearings: readonly AudioHearing[]) =>
  hearings.reduce<{ heard: HeardAudio | null; judged: unknown[] }>(
    ({ heard, judged }, hearing) => {
      const next = hearAudio({ heard, hearing })
      return {
        heard: next.heard,
        judged: next.toJudge === null ? judged : [...judged, next.toJudge],
      }
    },
    { heard: null, judged: [] },
  )

const loaded = (place: number | null, picked: number): AudioHearing => ({
  type: AUDIO_HEARINGS.loaded,
  attempt: ATTEMPT,
  reported: pickedAt(picked),
  place,
})

const moved = (clock: number): AudioHearing => ({
  type: AUDIO_HEARINGS.moved,
  attempt: ATTEMPT,
  clock,
})

describe('hearAudio', () => {
  it('judges at the first tick after a load whose pick is already the asked one', () => {
    expect(hearAll([loaded(1, 1), moved(0)]).judged).toEqual([pickedAt(1)])
  })

  it('takes any pick where the player was left to choose', () => {
    expect(hearAll([loaded(null, 0), moved(0)]).judged).toEqual([pickedAt(0)])
  })

  it('never judges a tick before the load, which ExoPlayer sends first', () => {
    expect(hearAll([moved(0), moved(1), moved(3)]).judged).toEqual([])
  })

  it("waits for the settled tracks when the load names ExoPlayer's own first pick", () => {
    const tracks: AudioHearing = {
      type: AUDIO_HEARINGS.tracks,
      attempt: ATTEMPT,
      reported: pickedAt(1),
    }
    expect(hearAll([loaded(1, 0), moved(0), moved(1)]).judged).toEqual([])
    expect(hearAll([loaded(1, 0), moved(0), tracks, moved(0.25)]).judged).toEqual([pickedAt(1)])
  })

  it('judges an unsettled pick as it stands once it has played for the settle time', () => {
    expect(hearAll([loaded(1, 0), moved(10), moved(11)]).judged).toEqual([])
    expect(
      hearAll([loaded(1, 0), moved(10), moved(11), moved(10 + AUDIO_SETTLE_SECONDS)]).judged,
    ).toEqual([pickedAt(0)])
  })

  it('counts only the time played, never the jump of a seek, toward the settle time', () => {
    const sought = (clock: number): AudioHearing => ({
      type: AUDIO_HEARINGS.sought,
      attempt: ATTEMPT,
      clock,
    })
    // Half a second in, the viewer skips ten seconds on and plays on half a second more.
    expect(hearAll([loaded(1, 0), moved(0), moved(0.5), sought(10.5), moved(11)]).judged).toEqual(
      [],
    )
    // And ten seconds back: the clock going back takes nothing off what was played.
    const back = [loaded(1, 0), moved(20), moved(21), sought(11), moved(11.5), moved(12)]
    expect(hearAll(back).judged).toEqual([pickedAt(0)])
  })

  it('judges each attempt once, and leaves an earlier attempt alone', () => {
    const { heard, judged } = hearAll([loaded(1, 1), moved(0), moved(1), moved(5)])
    expect(judged).toHaveLength(1)
    const stale = hearAudio({ heard, hearing: { ...moved(6), attempt: ATTEMPT - 1 } })
    expect(stale).toEqual({ heard, toJudge: null })
  })
})
