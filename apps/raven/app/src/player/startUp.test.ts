import { describe, expect, it } from 'bun:test'

import {
  NOT_LOADED,
  START_EVENTS,
  START_PHASES,
  isHeldOf,
  isStartedOf,
  startReducer,
} from '@/player/startUp'

describe('startReducer', () => {
  it('holds a video that resumes from a spot until its seek has landed', () => {
    const loaded = startReducer(NOT_LOADED, { type: START_EVENTS.loaded, attempt: 1, at: 1282 })
    expect(loaded).toEqual({ attempt: 1, phase: START_PHASES.seeking })
    expect(isHeldOf(loaded)).toBe(true)
    expect(isStartedOf({ state: loaded, attempt: 1 })).toBe(false)
    const landed = startReducer(loaded, { type: START_EVENTS.landed, attempt: 1 })
    expect(isHeldOf(landed)).toBe(false)
    expect(isStartedOf({ state: landed, attempt: 1 })).toBe(true)
  })

  it('lets a video from the very beginning play as it loads, with no seek to wait for', () => {
    const loaded = startReducer(NOT_LOADED, { type: START_EVENTS.loaded, attempt: 1, at: 0 })
    expect(isStartedOf({ state: loaded, attempt: 1 })).toBe(true)
  })

  it('holds each new attempt afresh, never playing it on what the last one earned', () => {
    const first = startReducer(NOT_LOADED, { type: START_EVENTS.loaded, attempt: 1, at: 0 })
    expect(isStartedOf({ state: first, attempt: 2 })).toBe(false)
    const second = startReducer(first, { type: START_EVENTS.loaded, attempt: 2, at: 90 })
    expect(isHeldOf(second)).toBe(true)
  })

  it('ignores what an earlier attempt says late', () => {
    const second = startReducer(NOT_LOADED, { type: START_EVENTS.loaded, attempt: 2, at: 90 })
    expect(startReducer(second, { type: START_EVENTS.loaded, attempt: 1, at: 0 })).toBe(second)
    expect(startReducer(second, { type: START_EVENTS.landed, attempt: 1 })).toBe(second)
    expect(startReducer(NOT_LOADED, { type: START_EVENTS.landed, attempt: 1 })).toBe(NOT_LOADED)
  })
})
