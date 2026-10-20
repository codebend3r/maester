import { describe, expect, it } from 'bun:test'
import { SAVE_EVERY_S, progressStepOf } from '@/components/Player/watchProgress'
import { type VideoState, initialVideoState } from '@/components/Player/videoState'

const STILL = initialVideoState(20)
const PLAYING = { ...STILL, paused: false, waiting: false }

describe('progressStepOf', () => {
  it('starts once frames flow, never while the video waits', () => {
    expect(
      progressStepOf({
        state: { ...PLAYING, waiting: true },
        previous: STILL,
        hasStarted: false,
        lastSaved: 20,
        position: 20,
        duration: 120,
      }),
    ).toEqual({ isStarting: false, saveAt: null })
    expect(
      progressStepOf({
        state: PLAYING,
        previous: STILL,
        hasStarted: false,
        lastSaved: 20,
        position: 20,
        duration: 120,
      }),
    ).toEqual({ isStarting: true, saveAt: null })
  })

  it(`saves once the clock is ${SAVE_EVERY_S} seconds from the last save, on a pause, and at the end`, () => {
    const step = ({
      state,
      previous,
      position,
    }: {
      state: VideoState
      previous: VideoState
      position: number
    }) =>
      progressStepOf({ state, previous, hasStarted: true, lastSaved: 20, position, duration: 120 })
    expect(
      step({ state: { ...PLAYING, time: 29 }, previous: PLAYING, position: 29 }).saveAt,
    ).toBeNull()
    expect(step({ state: { ...PLAYING, time: 30 }, previous: PLAYING, position: 30 }).saveAt).toBe(
      30,
    )
    expect(step({ state: { ...STILL, time: 25 }, previous: PLAYING, position: 25 }).saveAt).toBe(25)
    expect(
      step({ state: { ...PLAYING, time: 120, ended: true }, previous: PLAYING, position: 118 })
        .saveAt,
    ).toBe(120)
    expect(step({ state: { ...STILL, time: 25 }, previous: STILL, position: 25 }).saveAt).toBeNull()
  })

  it('saves nothing before playback has started, which would wipe the resume spot', () => {
    expect(
      progressStepOf({
        state: { ...STILL, time: 90 },
        previous: STILL,
        hasStarted: false,
        lastSaved: 20,
        position: 90,
        duration: 120,
      }).saveAt,
    ).toBeNull()
  })

  it('saves where the video is, not a length it does not know, at an end with no duration', () => {
    expect(
      progressStepOf({
        state: { ...PLAYING, ended: true },
        previous: PLAYING,
        hasStarted: true,
        lastSaved: 20,
        position: 64,
        duration: null,
      }).saveAt,
    ).toBe(64)
  })
})
