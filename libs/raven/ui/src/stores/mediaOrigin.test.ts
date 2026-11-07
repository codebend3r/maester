import { describe, expect, it } from 'bun:test'
import type { MediaOrigin } from '@raven/core'
import { useMediaOrigin } from '@/stores/mediaOrigin'

const origin: MediaOrigin = { kind: 'public', url: 'https://raven.example:8443' }

describe('useMediaOrigin', () => {
  it('holds the pick the host sets, and clears it', () => {
    useMediaOrigin.getState().setPick({ origin, at: 1000 })
    expect(useMediaOrigin.getState().pick).toEqual({ origin, at: 1000 })
    useMediaOrigin.getState().setPick(null)
    expect(useMediaOrigin.getState().pick).toBeNull()
  })

  it('keeps nothing in localStorage, so an old pick never comes back', () => {
    useMediaOrigin.getState().setPick({ origin, at: 1000 })
    expect(window.localStorage.length).toBe(0)
  })
})
