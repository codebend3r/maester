import { describe, expect, it } from 'bun:test'
import type { MediaOrigin } from '@raven/core'
import {
  PICK_FRESH_MS,
  isFreshPick,
  sessionOrMemoryStorage,
  useMediaOrigin,
} from '@/stores/mediaOrigin'

const origin: MediaOrigin = { kind: 'lan', url: 'https://lan.example' }

const withThrowingSessionStorage = (run: () => void) => {
  const original = Object.getOwnPropertyDescriptor(window, 'sessionStorage')
  Object.defineProperty(window, 'sessionStorage', {
    configurable: true,
    get: () => {
      throw new Error('storage is blocked')
    },
  })
  try {
    run()
  } finally {
    if (original) Object.defineProperty(window, 'sessionStorage', original)
  }
}

describe('useMediaOrigin', () => {
  it('keeps the pick in sessionStorage, and only the pick', () => {
    useMediaOrigin.getState().setProbing(true)
    useMediaOrigin.getState().setPick({ origin, at: 1000 })
    const stored = JSON.parse(window.sessionStorage.getItem('raven-media-origin') ?? 'null')
    expect(stored.state).toEqual({ pick: { origin, at: 1000 } })
    useMediaOrigin.getState().setPick(null)
    expect(useMediaOrigin.getState().pick).toBeNull()
    const cleared = JSON.parse(window.sessionStorage.getItem('raven-media-origin') ?? 'null')
    expect(cleared.state.pick).toBeNull()
  })

  it('takes a stored pick back on rehydrate, and drops one that is not a pick', async () => {
    window.sessionStorage.setItem(
      'raven-media-origin',
      JSON.stringify({ state: { pick: { origin, at: 5 } }, version: 0 }),
    )
    await useMediaOrigin.persist.rehydrate()
    expect(useMediaOrigin.getState().pick).toEqual({ origin, at: 5 })
    window.sessionStorage.setItem(
      'raven-media-origin',
      JSON.stringify({
        state: { pick: { origin: { kind: 'moon', url: 3 }, at: 'now' } },
        version: 0,
      }),
    )
    await useMediaOrigin.persist.rehydrate()
    expect(useMediaOrigin.getState().pick).toBeNull()
  })

  it('still works when sessionStorage throws', () => {
    withThrowingSessionStorage(() => {
      useMediaOrigin.getState().setPick({ origin, at: 7 })
      expect(useMediaOrigin.getState().pick).toEqual({ origin, at: 7 })
    })
  })
})

describe('sessionOrMemoryStorage', () => {
  it('is sessionStorage while it works', () => {
    expect(sessionOrMemoryStorage()).toBe(window.sessionStorage)
  })

  it('falls back to a working in-memory store when sessionStorage throws', () => {
    withThrowingSessionStorage(() => {
      const storage = sessionOrMemoryStorage()
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

describe('isFreshPick', () => {
  const pick = { origin, at: 10_000 }

  it('is fresh for ten minutes after the probe', () => {
    expect(isFreshPick({ pick, now: 10_000 })).toBe(true)
    expect(isFreshPick({ pick, now: 10_000 + PICK_FRESH_MS - 1 })).toBe(true)
    expect(isFreshPick({ pick, now: 10_000 + PICK_FRESH_MS })).toBe(false)
  })

  it('is not fresh with no pick, or one stamped in the future', () => {
    expect(isFreshPick({ pick: null, now: 10_000 })).toBe(false)
    expect(isFreshPick({ pick, now: 9_999 })).toBe(false)
  })
})
