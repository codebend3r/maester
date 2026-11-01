import { describe, expect, it } from 'bun:test'
import { freshSpeed, MIN_READING_MS, nextSample, STALE_MS } from '@/desktop/downloadSpeed'

describe('nextSample', () => {
  it('has no speed from a first reading', () => {
    expect(nextSample({ previous: undefined, bytes: 100, now: 0 })).toEqual({
      bytes: 100,
      at: 0,
      bytesPerSecond: null,
    })
  })

  it('reads bytes a second off the second reading', () => {
    const first = nextSample({ previous: undefined, bytes: 0, now: 0 })
    expect(nextSample({ previous: first, bytes: 5_000_000, now: 1000 }).bytesPerSecond).toBe(
      5_000_000,
    )
  })

  it('smooths later readings toward the new speed', () => {
    const steady = { bytes: 1000, at: 1000, bytesPerSecond: 1000 }
    const next = nextSample({ previous: steady, bytes: 1000, now: 2000 })
    expect(next.bytesPerSecond).toBe(700)
  })

  it('ignores a reading heard twice in a moment', () => {
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

describe('freshSpeed', () => {
  const sample = { bytes: 1, at: 1000, bytesPerSecond: 42 }

  it('is the sample speed while it is recent', () => {
    expect(freshSpeed({ sample, now: 1000 + STALE_MS })).toBe(42)
  })

  it('is null once it went quiet, or with no sample or no speed yet', () => {
    expect(freshSpeed({ sample, now: 1001 + STALE_MS })).toBeNull()
    expect(freshSpeed({ sample: undefined, now: 0 })).toBeNull()
    expect(freshSpeed({ sample: { ...sample, bytesPerSecond: null }, now: 1000 })).toBeNull()
  })
})
