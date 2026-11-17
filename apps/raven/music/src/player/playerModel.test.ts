import { describe, expect, it } from 'bun:test'

import { progressOf, remainingTextOf, scrubTextOf } from '@/player/playerModel'

describe('progressOf', () => {
  it('is the share played, never past the end', () => {
    expect(progressOf({ position: 66, length: 264 })).toBe(0.25)
    expect(progressOf({ position: 300, length: 264 })).toBe(1)
  })

  it('is nothing while the length is unknown', () => {
    expect(progressOf({ position: 12, length: 0 })).toBe(0)
  })
})

describe('remainingTextOf', () => {
  it('says how long is left, never below nothing', () => {
    expect(remainingTextOf({ position: 196, length: 265 })).toBe('-1:09')
    expect(remainingTextOf({ position: 300, length: 265 })).toBe('-0:00')
  })
})

describe('scrubTextOf', () => {
  it('reads out how far in it is, of how long', () => {
    expect(scrubTextOf({ position: 62, length: 284 })).toBe('1:02 of 4:44')
  })
})
