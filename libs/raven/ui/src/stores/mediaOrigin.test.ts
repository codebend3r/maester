import { describe, expect, it } from 'bun:test'
import type { MediaOrigin } from '@raven/core'
import { PICK_FRESH_MS, isFreshPick, useMediaOrigin } from '@/stores/mediaOrigin'
import { STORE_KEYS } from '@/stores/storage'

const origin: MediaOrigin = { kind: 'lan', url: 'https://lan.example' }

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

describe('useMediaOrigin', () => {
  it('keeps the pick in localStorage, and only the pick', () => {
    useMediaOrigin.getState().setProbing(true)
    useMediaOrigin.getState().setPick({ origin, at: 1000 })
    const stored = JSON.parse(window.localStorage.getItem(STORE_KEYS.mediaOrigin) ?? 'null')
    expect(stored.state).toEqual({ pick: { origin, at: 1000 } })
    useMediaOrigin.getState().setPick(null)
    expect(useMediaOrigin.getState().pick).toBeNull()
    const cleared = JSON.parse(window.localStorage.getItem(STORE_KEYS.mediaOrigin) ?? 'null')
    expect(cleared.state.pick).toBeNull()
  })

  it('takes a stored pick back on rehydrate, and drops one that is not a pick', async () => {
    window.localStorage.setItem(
      STORE_KEYS.mediaOrigin,
      JSON.stringify({ state: { pick: { origin, at: 5 } }, version: 0 }),
    )
    await useMediaOrigin.persist.rehydrate()
    expect(useMediaOrigin.getState().pick).toEqual({ origin, at: 5 })
    window.localStorage.setItem(
      STORE_KEYS.mediaOrigin,
      JSON.stringify({
        state: { pick: { origin: { kind: 'moon', url: 3 }, at: 'now' } },
        version: 0,
      }),
    )
    await useMediaOrigin.persist.rehydrate()
    expect(useMediaOrigin.getState().pick).toBeNull()
  })

  it('keeps the pick in the store when localStorage throws', () => {
    withThrowingLocalStorage(() => {
      useMediaOrigin.getState().setPick({ origin, at: 7 })
      expect(useMediaOrigin.getState().pick).toEqual({ origin, at: 7 })
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
