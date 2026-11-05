import { describe, expect, it } from 'bun:test'
import { type MediaOrigin, PICK_FRESH_MS, type RemotePlayback } from '@raven/core'
import { isFreshPick, useMediaOrigin } from '@/stores/mediaOrigin'
import { STORE_KEYS } from '@/stores/storage'

const origin: MediaOrigin = { kind: 'lan', url: 'https://lan.example' }
const remote: RemotePlayback = { limit: 'high720', isOutside: true }

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
  it('keeps the pick, with its word on remote play, in localStorage, and only that', () => {
    useMediaOrigin.getState().setProbing(true)
    useMediaOrigin.getState().setPick({ origin, at: 1000, remote })
    const stored = JSON.parse(window.localStorage.getItem(STORE_KEYS.mediaOrigin) ?? 'null')
    expect(stored.state).toEqual({ pick: { origin, at: 1000, remote } })
    useMediaOrigin.getState().setPick({ origin: null, at: 2000, remote: null })
    const none = JSON.parse(window.localStorage.getItem(STORE_KEYS.mediaOrigin) ?? 'null')
    expect(none.state.pick).toEqual({ origin: null, at: 2000, remote: null })
    useMediaOrigin.getState().setPick(null)
    expect(useMediaOrigin.getState().pick).toBeNull()
  })

  it('takes a stored pick back on rehydrate, and drops one that is not a pick', async () => {
    window.localStorage.setItem(
      STORE_KEYS.mediaOrigin,
      JSON.stringify({ state: { pick: { origin, at: 5, remote } }, version: 0 }),
    )
    await useMediaOrigin.persist.rehydrate()
    expect(useMediaOrigin.getState().pick).toEqual({ origin, at: 5, remote })
    window.localStorage.setItem(
      STORE_KEYS.mediaOrigin,
      JSON.stringify({
        state: { pick: { origin, at: 5, remote: { limit: 'huge', isOutside: 'yes' } } },
        version: 0,
      }),
    )
    await useMediaOrigin.persist.rehydrate()
    expect(useMediaOrigin.getState().pick).toBeNull()
    window.localStorage.setItem(
      STORE_KEYS.mediaOrigin,
      JSON.stringify({
        state: { pick: { origin: { kind: 'moon', url: 3 }, at: 'now', remote: null } },
        version: 0,
      }),
    )
    await useMediaOrigin.persist.rehydrate()
    expect(useMediaOrigin.getState().pick).toBeNull()
  })

  it('drops a pick stored before it carried its word on remote play', async () => {
    window.localStorage.setItem(
      STORE_KEYS.mediaOrigin,
      JSON.stringify({ state: { pick: { origin, at: 5 }, remote }, version: 0 }),
    )
    await useMediaOrigin.persist.rehydrate()
    expect(useMediaOrigin.getState().pick).toBeNull()
  })

  it('remembers that a probe has ended, and never keeps that', async () => {
    useMediaOrigin.setState({ hasProbed: false })
    useMediaOrigin.getState().setProbing(true)
    expect(useMediaOrigin.getState().hasProbed).toBe(false)
    useMediaOrigin.getState().setProbing(false)
    expect(useMediaOrigin.getState().hasProbed).toBe(true)
    const stored = JSON.parse(window.localStorage.getItem(STORE_KEYS.mediaOrigin) ?? 'null')
    expect(Object.keys(stored.state)).toEqual(['pick'])
    useMediaOrigin.setState({ hasProbed: false })
    await useMediaOrigin.persist.rehydrate()
    expect(useMediaOrigin.getState().hasProbed).toBe(false)
  })

  it('keeps the pick in the store when localStorage throws', () => {
    withThrowingLocalStorage(() => {
      useMediaOrigin.getState().setPick({ origin, at: 7, remote })
      expect(useMediaOrigin.getState().pick).toEqual({ origin, at: 7, remote })
    })
  })
})

describe('isFreshPick', () => {
  const pick = { origin, at: 10_000, remote }

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
