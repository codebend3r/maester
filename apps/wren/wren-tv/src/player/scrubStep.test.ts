import { describe, expect, it } from 'bun:test'

import { SCRUB_KEYS, SCRUB_STEP, scrubStepOf } from '@/player/scrubStep'

describe('scrubStepOf', () => {
  it('moves the playhead a step on with right and a step back with left', () => {
    expect(scrubStepOf({ event: { eventType: SCRUB_KEYS.right }, position: 30, length: 200 })).toBe(
      30 + SCRUB_STEP,
    )
    expect(scrubStepOf({ event: { eventType: SCRUB_KEYS.left }, position: 30, length: 200 })).toBe(
      30 - SCRUB_STEP,
    )
  })

  it('holds the playhead between the start and the end', () => {
    expect(scrubStepOf({ event: { eventType: SCRUB_KEYS.left }, position: 5, length: 200 })).toBe(0)
    expect(
      scrubStepOf({ event: { eventType: SCRUB_KEYS.right }, position: 195, length: 200 }),
    ).toBe(200)
  })

  it('counts an Android TV key once, as it comes up', () => {
    const right = { eventType: SCRUB_KEYS.right }
    expect(
      scrubStepOf({ event: { ...right, eventKeyAction: 0 }, position: 0, length: 60 }),
    ).toBeNull()
    expect(scrubStepOf({ event: { ...right, eventKeyAction: 1 }, position: 0, length: 60 })).toBe(
      SCRUB_STEP,
    )
  })

  it('leaves every other key alone', () => {
    expect(scrubStepOf({ event: { eventType: 'select' }, position: 10, length: 60 })).toBeNull()
    expect(scrubStepOf({ event: null, position: 10, length: 60 })).toBeNull()
  })
})
