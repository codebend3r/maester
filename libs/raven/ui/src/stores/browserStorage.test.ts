import { describe, expect, it } from 'bun:test'
import { localOrMemoryStorage } from '@/stores/browserStorage'

const withThrowingLocalStorage = (run: () => void) => {
  const original = Object.getOwnPropertyDescriptor(window, 'localStorage')
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    get: () => {
      throw new Error('storage is blocked')
    },
  })
  try {
    run()
  } finally {
    if (original) Object.defineProperty(window, 'localStorage', original)
  }
}

describe('localOrMemoryStorage', () => {
  it('is localStorage while it works', () => {
    expect(localOrMemoryStorage()).toBe(window.localStorage)
  })

  it('falls back to a working in-memory store when localStorage throws', () => {
    withThrowingLocalStorage(() => {
      const storage = localOrMemoryStorage()
      storage.setItem('a', '1')
      storage.setItem('b', '2')
      expect(storage.getItem('a')).toBe('1')
      expect(storage.length).toBe(2)
      expect(storage.key(1)).toBe('b')
      expect(storage.key(9)).toBeNull()
      storage.removeItem('a')
      expect(storage.getItem('a')).toBeNull()
      storage.clear()
      expect(storage.length).toBe(0)
    })
  })
})
