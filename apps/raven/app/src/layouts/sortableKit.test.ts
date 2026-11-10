import { describe, expect, it } from 'bun:test'

import {
  MOVE_STEPS,
  dropIndexOf,
  landingBeforeOf,
  shiftOf,
  stepMoveOf,
} from '@/layouts/sortableKit'

const KEYS = ['running', 'a', 'b', 'c', 'd'] as const

/** One pinned row, then four queued. */
const LINE = { pinnedCount: 1, movableCount: 4 }

describe('dropIndexOf', () => {
  it('rounds the drag to whole rows', () => {
    expect(dropIndexOf({ ...LINE, from: 1, dy: 0, rowHeight: 100 })).toBe(1)
    expect(dropIndexOf({ ...LINE, from: 1, dy: 49, rowHeight: 100 })).toBe(1)
    expect(dropIndexOf({ ...LINE, from: 1, dy: 51, rowHeight: 100 })).toBe(2)
    expect(dropIndexOf({ ...LINE, from: 3, dy: -149, rowHeight: 100 })).toBe(2)
  })

  it('never lands above the pinned rows or past the last movable one', () => {
    expect(dropIndexOf({ ...LINE, from: 1, dy: -500, rowHeight: 100 })).toBe(1)
    expect(dropIndexOf({ ...LINE, from: 2, dy: 900, rowHeight: 100 })).toBe(4)
  })

  it('stays put with nothing to move among, or no height to measure by', () => {
    expect(dropIndexOf({ from: 1, dy: 300, rowHeight: 100, pinnedCount: 1, movableCount: 0 })).toBe(
      1,
    )
    expect(dropIndexOf({ ...LINE, from: 2, dy: 300, rowHeight: 0 })).toBe(2)
  })
})

describe('landingBeforeOf', () => {
  it('names the row the slot sits before, moving up', () => {
    expect(landingBeforeOf({ keys: KEYS, from: 3, to: 1 })).toBe('a')
  })

  it('names the row after the slot moving down, since the row leaves its own place', () => {
    expect(landingBeforeOf({ keys: KEYS, from: 1, to: 2 })).toBe('c')
  })

  it('is null for the end of the list', () => {
    expect(landingBeforeOf({ keys: KEYS, from: 1, to: 4 })).toBeNull()
  })
})

describe('shiftOf', () => {
  it('parts the rows the slot passed, and leaves the rest and the dragged row alone', () => {
    const down = { from: 1, to: 3, rowHeight: 100 }
    expect([0, 1, 2, 3, 4].map((index) => shiftOf({ ...down, index }))).toEqual([
      0, 0, -100, -100, 0,
    ])
    const up = { from: 3, to: 1, rowHeight: 100 }
    expect([0, 1, 2, 3, 4].map((index) => shiftOf({ ...up, index }))).toEqual([0, 100, 100, 0, 0])
  })
})

describe('stepMoveOf', () => {
  it('moves a row one place up or down', () => {
    expect(stepMoveOf({ ...LINE, keys: KEYS, index: 2, step: MOVE_STEPS.up })).toEqual({
      key: 'b',
      before: 'a',
    })
    expect(stepMoveOf({ ...LINE, keys: KEYS, index: 2, step: MOVE_STEPS.down })).toEqual({
      key: 'b',
      before: 'd',
    })
    expect(stepMoveOf({ ...LINE, keys: KEYS, index: 3, step: MOVE_STEPS.down })).toEqual({
      key: 'c',
      before: null,
    })
  })

  it('has nowhere to go above the pinned rows or past the last', () => {
    expect(stepMoveOf({ ...LINE, keys: KEYS, index: 1, step: MOVE_STEPS.up })).toBeNull()
    expect(stepMoveOf({ ...LINE, keys: KEYS, index: 4, step: MOVE_STEPS.down })).toBeNull()
    expect(stepMoveOf({ ...LINE, keys: KEYS, index: 9, step: MOVE_STEPS.down })).toBeNull()
  })
})
