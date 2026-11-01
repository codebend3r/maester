import { describe, expect, it } from 'bun:test'
import { lockState } from '@/lib/libraryLock'

describe('lockState', () => {
  it('leaves a library that is not locked open, whatever the lock says', () => {
    expect(lockState({ locked: false, lock: undefined })).toEqual({ state: 'open' })
    expect(lockState({ locked: false, lock: { available: true, unlocked: false } })).toEqual({
      state: 'open',
    })
  })

  it('checks a locked library until the server says whether this browser holds the PIN', () => {
    expect(lockState({ locked: true, lock: undefined })).toEqual({ state: 'checking' })
  })

  it('opens a locked library once the PIN is entered, and keeps it shut until then', () => {
    expect(lockState({ locked: true, lock: { available: true, unlocked: true } })).toEqual({
      state: 'open',
    })
    expect(lockState({ locked: true, lock: { available: false, unlocked: false } })).toEqual({
      state: 'shut',
    })
  })
})
