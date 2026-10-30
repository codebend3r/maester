import { describe, expect, it } from 'bun:test'

import { CENTRE_MARKS, markOfPress, shownMarkOf } from '@/layouts/centreMark'

describe('markOfPress', () => {
  it('flashes a skip by its way', () => {
    expect(markOfPress({ seekBy: -10, shouldTogglePlay: false, isPaused: false })).toBe(
      CENTRE_MARKS.back,
    )
    expect(markOfPress({ seekBy: 10, shouldTogglePlay: false, isPaused: false })).toBe(
      CENTRE_MARKS.forward,
    )
  })

  it('flashes play as a paused video starts, and nothing as one pauses', () => {
    expect(markOfPress({ seekBy: 0, shouldTogglePlay: true, isPaused: true })).toBe(
      CENTRE_MARKS.play,
    )
    expect(markOfPress({ seekBy: 0, shouldTogglePlay: true, isPaused: false })).toBeNull()
    expect(markOfPress({ seekBy: 0, shouldTogglePlay: false, isPaused: true })).toBeNull()
  })
})

describe('shownMarkOf', () => {
  it('holds the pause mark while paused, over a flash or a hold', () => {
    expect(shownMarkOf({ isPaused: true, held: 1, flash: CENTRE_MARKS.back })).toEqual({
      mark: CENTRE_MARKS.pause,
      isFading: false,
    })
  })

  it("holds a hold's way while the key is held", () => {
    expect(shownMarkOf({ isPaused: false, held: -1, flash: null })).toEqual({
      mark: CENTRE_MARKS.back,
      isFading: false,
    })
    expect(shownMarkOf({ isPaused: false, held: 1, flash: CENTRE_MARKS.back })).toEqual({
      mark: CENTRE_MARKS.forward,
      isFading: false,
    })
  })

  it('fades the last flash, and shows nothing before any', () => {
    expect(shownMarkOf({ isPaused: false, held: null, flash: CENTRE_MARKS.play })).toEqual({
      mark: CENTRE_MARKS.play,
      isFading: true,
    })
    expect(shownMarkOf({ isPaused: false, held: null, flash: null })).toBeNull()
  })
})
