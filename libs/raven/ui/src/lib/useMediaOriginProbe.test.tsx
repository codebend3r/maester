import { afterEach, beforeEach, describe, expect, it, mock, setSystemTime } from 'bun:test'
import { MEDIA_PROBE_BYTES, type MediaOrigin } from '@raven/core'
import { act, fireEvent, renderHook } from '@testing-library/react'
import { type ProbeFetch } from '@/lib/probeOrigins'
import { PICK_FRESH_MS, useMediaOrigin } from '@/stores/mediaOrigin'
import { useMediaOriginProbe } from '@/lib/useMediaOriginProbe'
import { api } from '@/test/api'

const lan: MediaOrigin = { kind: 'lan', url: 'https://lan.example' }
const pub: MediaOrigin = { kind: 'public', url: 'https://public.example' }
const NOW = 1_700_000_000_000

/** Both origins answer in full; the public one is twice as fast, so it wins outside the band. */
const answering = (): ProbeFetch =>
  mock(async (url: string) => {
    const isPublic = url.startsWith(pub.url)
    return {
      ok: true,
      body: new ReadableStream<Uint8Array>({
        pull: async (controller) => {
          await new Promise((resolve) => setTimeout(resolve, isPublic ? 1 : 12))
          controller.enqueue(new Uint8Array(MEDIA_PROBE_BYTES))
          controller.close()
        },
      }),
    }
  })

const clientWith = ({ origins }: { origins: MediaOrigin[] }) => ({
  ...api,
  getMediaOrigins: mock(async () => ({ origins })),
})

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 60))
  })

const setVisibility = (state: 'hidden' | 'visible') => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
  fireEvent(document, new Event('visibilitychange'))
}

beforeEach(() => {
  setSystemTime(new Date(NOW))
})

afterEach(() => {
  setSystemTime()
  Reflect.deleteProperty(document, 'visibilityState')
})

describe('useMediaOriginProbe', () => {
  it('clears the pick and probes nothing when the server offers no origins', async () => {
    useMediaOrigin.getState().setPick({ origin: lan, at: NOW })
    const fetch = answering()
    renderHook(() => useMediaOriginProbe({ api: clientWith({ origins: [] }), fetch }))
    await settle()
    expect(useMediaOrigin.getState().pick).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
    expect(useMediaOrigin.getState().isProbing).toBe(false)
  })

  it('picks the winner of a probe and stamps the time', async () => {
    const fetch = answering()
    renderHook(() => useMediaOriginProbe({ api: clientWith({ origins: [lan, pub] }), fetch }))
    await settle()
    expect(useMediaOrigin.getState().pick).toEqual({ origin: pub, at: NOW })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('clears the pick when no origin answers', async () => {
    useMediaOrigin.getState().setPick({ origin: lan, at: NOW - PICK_FRESH_MS * 2 })
    const fetch: ProbeFetch = async () => ({ ok: false, body: null })
    renderHook(() => useMediaOriginProbe({ api: clientWith({ origins: [lan] }), fetch }))
    await settle()
    expect(useMediaOrigin.getState().pick).toBeNull()
  })

  it('keeps a fresh stored pick without probing, and probes a stale one', async () => {
    useMediaOrigin.getState().setPick({ origin: lan, at: NOW - 1000 })
    const fresh = answering()
    const mounted = renderHook(() =>
      useMediaOriginProbe({ api: clientWith({ origins: [lan, pub] }), fetch: fresh }),
    )
    await settle()
    expect(fresh).not.toHaveBeenCalled()
    expect(useMediaOrigin.getState().pick?.origin).toEqual(lan)
    mounted.unmount()

    useMediaOrigin.getState().setPick({ origin: lan, at: NOW - PICK_FRESH_MS })
    const stale = answering()
    renderHook(() =>
      useMediaOriginProbe({ api: clientWith({ origins: [lan, pub] }), fetch: stale }),
    )
    await settle()
    expect(stale).toHaveBeenCalledTimes(2)
    expect(useMediaOrigin.getState().pick?.origin).toEqual(pub)
  })

  it('probes again when the fresh pick is no longer one of the origins', async () => {
    useMediaOrigin.getState().setPick({ origin: lan, at: NOW })
    const fetch = answering()
    renderHook(() => useMediaOriginProbe({ api: clientWith({ origins: [pub] }), fetch }))
    await settle()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(useMediaOrigin.getState().pick?.origin).toEqual(pub)
  })

  it('probes again on online, and on reprobe even when the pick is fresh', async () => {
    const fetch = answering()
    const { result } = renderHook(() =>
      useMediaOriginProbe({ api: clientWith({ origins: [lan, pub] }), fetch }),
    )
    await settle()
    expect(fetch).toHaveBeenCalledTimes(2)
    fireEvent(window, new Event('online'))
    await settle()
    expect(fetch).toHaveBeenCalledTimes(4)
    act(() => result.current.reprobe())
    await settle()
    expect(fetch).toHaveBeenCalledTimes(6)
  })

  it('does not start a probe while one is running', async () => {
    const getMediaOrigins = mock(async () => ({ origins: [lan] }))
    const { result } = renderHook(() =>
      useMediaOriginProbe({ api: { ...api, getMediaOrigins }, fetch: answering() }),
    )
    act(() => {
      result.current.reprobe()
      result.current.reprobe()
    })
    await settle()
    expect(getMediaOrigins).toHaveBeenCalledTimes(1)
  })

  it('re-probes on visibilitychange only after ten minutes hidden', async () => {
    const fetch = answering()
    renderHook(() => useMediaOriginProbe({ api: clientWith({ origins: [lan, pub] }), fetch }))
    await settle()
    expect(fetch).toHaveBeenCalledTimes(2)

    setVisibility('hidden')
    setSystemTime(new Date(NOW + PICK_FRESH_MS - 1))
    setVisibility('visible')
    await settle()
    expect(fetch).toHaveBeenCalledTimes(2)

    setVisibility('hidden')
    setSystemTime(new Date(NOW + PICK_FRESH_MS * 2))
    setVisibility('visible')
    await settle()
    expect(fetch).toHaveBeenCalledTimes(4)
  })

  it('swallows a failing origins request and leaves the pick alone', async () => {
    useMediaOrigin.getState().setPick({ origin: lan, at: NOW - PICK_FRESH_MS * 2 })
    const failing = { ...api, getMediaOrigins: mock(async () => Promise.reject(new Error('down'))) }
    renderHook(() => useMediaOriginProbe({ api: failing, fetch: answering() }))
    await settle()
    expect(useMediaOrigin.getState().pick?.origin).toEqual(lan)
    expect(useMediaOrigin.getState().isProbing).toBe(false)
  })

  it('stops listening on unmount', async () => {
    const fetch = answering()
    const { unmount } = renderHook(() =>
      useMediaOriginProbe({ api: clientWith({ origins: [lan, pub] }), fetch }),
    )
    await settle()
    unmount()
    fireEvent(window, new Event('online'))
    await settle()
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})
