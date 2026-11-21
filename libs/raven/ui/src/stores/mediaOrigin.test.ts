import { describe, expect, it } from 'bun:test'
import { DEFAULT_SERVER_ORIGIN, MEDIA_ORIGIN_KINDS, type MediaOrigin } from '@raven/core'
import { mediaOriginOf, useMediaOrigin } from '@/stores/mediaOrigin'

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

describe('mediaOriginOf', () => {
  it("names raven's public origin when /api is a proxy, so media never goes through it", () => {
    expect(mediaOriginOf({ apiOrigin: DEFAULT_SERVER_ORIGIN })).toEqual({
      kind: MEDIA_ORIGIN_KINDS.public,
      url: DEFAULT_SERVER_ORIGIN,
    })
  })

  it("names none when /api is raven itself, so media plays from the page's own address", () => {
    expect(mediaOriginOf({ apiOrigin: '' })).toBeNull()
  })
})
