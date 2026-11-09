import { describe, expect, it } from 'bun:test'

import {
  MIN_READING_MS,
  STALE_MS,
  durationLabelOf,
  freshSpeed,
  nextSample,
  secondsLeftOf,
  speedLabelOf,
  totalSpeed,
} from '@/downloadSpeed'

describe('nextSample', () => {
  it('has no speed from a first reading', () => {
    expect(nextSample({ previous: undefined, bytes: 100, now: 0 })).toEqual({
      bytes: 100,
      at: 0,
      bytesPerSecond: null,
    })
  })

  it('reads bytes a second off the second reading, then smooths each new one in', () => {
    const first = nextSample({ previous: undefined, bytes: 0, now: 0 })
    const second = nextSample({ previous: first, bytes: 1_000_000, now: 1000 })
    expect(second.bytesPerSecond).toBe(1_000_000)
    const third = nextSample({ previous: second, bytes: 4_000_000, now: 2000 })
    expect(third.bytesPerSecond).toBeCloseTo(1_600_000)
    const steady = { bytes: 1000, at: 1000, bytesPerSecond: 1000 }
    expect(nextSample({ previous: steady, bytes: 1000, now: 2000 }).bytesPerSecond).toBe(700)
  })

  it('keeps a reading heard twice within a moment', () => {
    const first = { bytes: 10, at: 1000, bytesPerSecond: 50 }
    expect(nextSample({ previous: first, bytes: 11, now: 1000 + MIN_READING_MS - 1 })).toBe(first)
  })

  it('starts over when the file began again', () => {
    const first = { bytes: 900, at: 0, bytesPerSecond: 90 }
    expect(nextSample({ previous: first, bytes: 10, now: 1000 })).toEqual({
      bytes: 10,
      at: 1000,
      bytesPerSecond: null,
    })
  })
})

describe('freshSpeed and totalSpeed', () => {
  const moving = { bytes: 1, at: 1000, bytesPerSecond: 2_000_000 }
  const quiet = { bytes: 1, at: 0, bytesPerSecond: 9_000_000 }
  const now = 1000 + STALE_MS

  it('is the sample speed while it is recent, none once it went quiet, and none with no sample or no speed yet', () => {
    expect(freshSpeed({ sample: moving, now })).toBe(2_000_000)
    expect(freshSpeed({ sample: moving, now: now + 1 })).toBeNull()
    expect(freshSpeed({ sample: quiet, now })).toBeNull()
    expect(freshSpeed({ sample: undefined, now: 0 })).toBeNull()
    expect(freshSpeed({ sample: { ...moving, bytesPerSecond: null }, now: 1000 })).toBeNull()
  })

  it('adds up the fresh speeds, and is null while none is fresh', () => {
    expect(totalSpeed({ samples: [moving, moving, quiet], now })).toBe(4_000_000)
    expect(totalSpeed({ samples: [quiet], now })).toBeNull()
  })
})

describe('the labels', () => {
  it('says a speed as the desktop does', () => {
    expect(speedLabelOf(12_400_000)).toBe('12.4 MB/s')
    expect(speedLabelOf(640_000)).toBe('640 KB/s')
    expect(speedLabelOf(null)).toBeNull()
  })

  it('divides what is left by the speed, rounding up, and says nothing while the download is not moving', () => {
    expect(secondsLeftOf({ remaining: 1_000_001, bytesPerSecond: 1_000_000 })).toBe(2)
    expect(secondsLeftOf({ remaining: 1000, bytesPerSecond: null })).toBeNull()
    expect(secondsLeftOf({ remaining: 1000, bytesPerSecond: 0 })).toBeNull()
  })

  it('reads a time left as seconds, minutes, then hours and minutes', () => {
    expect(durationLabelOf(0)).toBe('1s')
    expect(durationLabelOf(45)).toBe('45s')
    expect(durationLabelOf(2141)).toBe('36m')
    expect(durationLabelOf(3600)).toBe('1h')
    expect(durationLabelOf(4320)).toBe('1h 12m')
  })
})
