import { describe, expect, it } from 'bun:test'

import { CENTRE_MARKS, flashOfSkip, flashOfToggle, shownMarkOf } from '@/layouts/centreMark'
import { SKIP_SECONDS } from '@/layouts/playerKit'

describe('flashOfSkip', () => {
  it('flashes a skip by its way and how far it went', () => {
    expect(flashOfSkip({ direction: -1, seconds: 20, at: 0 })).toEqual({
      mark: CENTRE_MARKS.back,
      seconds: 20,
    })
    expect(flashOfSkip({ direction: 1, seconds: 10, at: 0 }).mark).toBe(CENTRE_MARKS.forward)
  })
})

describe('flashOfToggle', () => {
  it('flashes play as a paused video starts, and nothing as one pauses', () => {
    expect(flashOfToggle(true)?.mark).toBe(CENTRE_MARKS.play)
    expect(flashOfToggle(false)).toBeNull()
  })
})

describe('shownMarkOf', () => {
  const skipped = { mark: CENTRE_MARKS.back, seconds: 20 }

  it('holds the pause mark while paused, over a flash or a hold', () => {
    expect(shownMarkOf({ isPaused: true, held: 1, flash: skipped })).toMatchObject({
      mark: CENTRE_MARKS.pause,
      isFading: false,
    })
  })

  it("holds a hold's way while the key is held, beside its first step", () => {
    expect(shownMarkOf({ isPaused: false, held: -1, flash: null })).toEqual({
      mark: CENTRE_MARKS.back,
      seconds: SKIP_SECONDS,
      isFading: false,
    })
    expect(shownMarkOf({ isPaused: false, held: 1, flash: skipped })).toEqual({
      mark: CENTRE_MARKS.forward,
      seconds: SKIP_SECONDS,
      isFading: false,
    })
  })

  it('fades the last flash with how far it went, and shows nothing before any', () => {
    expect(shownMarkOf({ isPaused: false, held: null, flash: skipped })).toEqual({
      mark: CENTRE_MARKS.back,
      seconds: 20,
      isFading: true,
    })
    expect(shownMarkOf({ isPaused: false, held: null, flash: null })).toBeNull()
  })
})
