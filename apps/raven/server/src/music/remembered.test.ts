import { afterEach, describe, expect, it, vi } from 'vitest'
import { Remembered } from '@/music/remembered'

describe('Remembered', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps a value until its time is up, then forgets it', () => {
    vi.useFakeTimers()
    const remembered = new Remembered<number, string>(1000)
    expect(remembered.get(1)).toBeNull()
    remembered.set({ key: 1, value: 'kept' })
    vi.advanceTimersByTime(999)
    expect(remembered.get(1)).toBe('kept')
    vi.advanceTimersByTime(1)
    expect(remembered.get(1)).toBeNull()
  })
})
