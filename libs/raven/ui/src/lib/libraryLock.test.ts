import { describe, expect, it } from 'bun:test'

import { LIBRARY_LOCK_STATES, lockState } from '@/lib/libraryLock'

describe('lockState', () => {
  it('leaves a library that is not locked open, whatever the lock says', () => {
    expect(lockState({ isLocked: false, lock: undefined })).toEqual({
      state: LIBRARY_LOCK_STATES.open,
    })
    expect(lockState({ isLocked: false, lock: { available: true, unlocked: false } })).toEqual({
      state: LIBRARY_LOCK_STATES.open,
    })
  })

  it('checks a locked library until the server says whether this device holds the PIN', () => {
    expect(lockState({ isLocked: true, lock: undefined })).toEqual({
      state: LIBRARY_LOCK_STATES.checking,
    })
  })

  it('opens a locked library once the PIN is entered here', () => {
    expect(lockState({ isLocked: true, lock: { available: true, unlocked: true } })).toEqual({
      state: LIBRARY_LOCK_STATES.open,
    })
  })

  it('shuts a locked library, with the unlock only where the PIN may be entered', () => {
    expect(lockState({ isLocked: true, lock: { available: true, unlocked: false } })).toEqual({
      state: LIBRARY_LOCK_STATES.shut,
      canUnlock: true,
    })
    expect(lockState({ isLocked: true, lock: { available: false, unlocked: false } })).toEqual({
      state: LIBRARY_LOCK_STATES.shut,
      canUnlock: false,
    })
  })
})
