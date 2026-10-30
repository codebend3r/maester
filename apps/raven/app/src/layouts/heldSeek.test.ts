import { describe, expect, it } from 'bun:test'

import { HOLD_ACTIONS, holdReducer, holdStepOf } from '@/layouts/heldSeek'
import { SKIP_SECONDS } from '@/layouts/playerKit'

const DOWN_AT = 1_000

const held = holdReducer(null, { type: HOLD_ACTIONS.down, direction: 1, at: 100, now: DOWN_AT })

describe('holdReducer', () => {
  it('starts where the video is', () => {
    expect(held).toEqual({ direction: 1, startedAt: DOWN_AT, at: 100 })
  })

  it('carries the playhead on each tick, faster the longer the key is held', () => {
    const first = holdReducer(held, { type: HOLD_ACTIONS.tick, now: DOWN_AT + 200, duration: 3000 })
    expect(first?.at ?? null).toBe(100 + SKIP_SECONDS)
    const later = holdReducer(first, {
      type: HOLD_ACTIONS.tick,
      now: DOWN_AT + 6000,
      duration: 3000,
    })
    expect(later?.at ?? null).toBe(100 + SKIP_SECONDS + 60)
  })

  it('stops at the start and at the end', () => {
    const back = holdReducer(null, { type: HOLD_ACTIONS.down, direction: -1, at: 4, now: DOWN_AT })
    expect(
      holdReducer(back, { type: HOLD_ACTIONS.tick, now: DOWN_AT, duration: 50 })?.at ?? null,
    ).toBe(0)
    expect(
      holdReducer(held, { type: HOLD_ACTIONS.tick, now: DOWN_AT, duration: 105 })?.at ?? null,
    ).toBe(105)
  })

  it('ends as the key comes up, and a tick with no hold changes nothing', () => {
    expect(holdReducer(held, { type: HOLD_ACTIONS.up })).toBeNull()
    expect(holdReducer(null, { type: HOLD_ACTIONS.tick, now: DOWN_AT, duration: null })).toBeNull()
  })
})

describe('holdStepOf', () => {
  it('skips ten seconds a tick at first, then faster the longer the key is held', () => {
    expect(holdStepOf(0)).toBe(SKIP_SECONDS)
    expect(holdStepOf(1999)).toBe(SKIP_SECONDS)
    expect(holdStepOf(2000)).toBe(30)
    expect(holdStepOf(5000)).toBe(60)
    expect(holdStepOf(60_000)).toBe(60)
  })
})
