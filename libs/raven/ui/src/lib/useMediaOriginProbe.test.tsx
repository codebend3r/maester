import { afterEach, beforeEach, describe, expect, it, mock, setSystemTime } from 'bun:test'
import { MEDIA_PROBE_BYTES, type MediaOrigin } from '@raven/core'
import { act, fireEvent, renderHook } from '@testing-library/react'
import { type ProbeFetch } from '@/lib/probeOrigins'
import { PICK_FRESH_MS, useMediaOrigin } from '@/stores/mediaOrigin'
import { PROBE_EVENTS, useMediaOriginProbe } from '@/lib/useMediaOriginProbe'
import { api } from '@/test/api'

const lan: MediaOrigin = { kind: 'lan', url: 'https://lan.example' }
const pub: MediaOrigin = { kind: 'public', url: 'https://public.example' }
const NOW = 1_700_000_000_000

/** The lan origin never answers well and the public one answers in full, so the public one always wins. */
const answering = (): ProbeFetch =>
  mock(async (url: string) => {
    if (url.startsWith(lan.url)) return { ok: false, body: null }
    return {
      ok: true,
      body: new ReadableStream<Uint8Array>({
        pull: (controller) => {
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
  fireEvent(document, new Event(PROBE_EVENTS.visibilityChange))
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
    renderHook(() =>
      useMediaOriginProbe({ isEnabled: true, api: clientWith({ origins: [] }), fetch }),
    )
    await settle()
    expect(useMediaOrigin.getState().pick).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
    expect(useMediaOrigin.getState().isProbing).toBe(false)
  })

  it('picks the winner of a probe and stamps the time', async () => {
    const fetch = answering()
    renderHook(() =>
      useMediaOriginProbe({ isEnabled: true, api: clientWith({ origins: [lan, pub] }), fetch }),
    )
    await settle()
    expect(useMediaOrigin.getState().pick).toEqual({ origin: pub, at: NOW })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('clears the pick when no origin answers', async () => {
    useMediaOrigin.getState().setPick({ origin: lan, at: NOW - PICK_FRESH_MS * 2 })
    const fetch: ProbeFetch = async () => ({ ok: false, body: null })
    renderHook(() =>
      useMediaOriginProbe({ isEnabled: true, api: clientWith({ origins: [lan] }), fetch }),
    )
    await settle()
    expect(useMediaOrigin.getState().pick).toBeNull()
  })

  it('keeps a fresh stored pick without probing, and probes a stale one', async () => {
    useMediaOrigin.getState().setPick({ origin: lan, at: NOW - 1000 })
    const fresh = answering()
    const mounted = renderHook(() =>
      useMediaOriginProbe({
        isEnabled: true,
        api: clientWith({ origins: [lan, pub] }),
        fetch: fresh,
      }),
    )
    await settle()
    expect(fresh).not.toHaveBeenCalled()
    expect(useMediaOrigin.getState().pick?.origin ?? null).toEqual(lan)
    mounted.unmount()

    useMediaOrigin.getState().setPick({ origin: lan, at: NOW - PICK_FRESH_MS })
    const stale = answering()
    renderHook(() =>
      useMediaOriginProbe({
        isEnabled: true,
        api: clientWith({ origins: [lan, pub] }),
        fetch: stale,
      }),
    )
    await settle()
    expect(stale).toHaveBeenCalledTimes(2)
    expect(useMediaOrigin.getState().pick?.origin ?? null).toEqual(pub)
  })

  it('probes again when the fresh pick is no longer one of the origins', async () => {
    useMediaOrigin.getState().setPick({ origin: lan, at: NOW })
    const fetch = answering()
    renderHook(() =>
      useMediaOriginProbe({ isEnabled: true, api: clientWith({ origins: [pub] }), fetch }),
    )
    await settle()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(useMediaOrigin.getState().pick?.origin ?? null).toEqual(pub)
  })

  it('probes again on online, and on reprobe even when the pick is fresh', async () => {
    const fetch = answering()
    const { result } = renderHook(() =>
      useMediaOriginProbe({ isEnabled: true, api: clientWith({ origins: [lan, pub] }), fetch }),
    )
    await settle()
    expect(fetch).toHaveBeenCalledTimes(2)
    fireEvent(window, new Event(PROBE_EVENTS.online))
    await settle()
    expect(fetch).toHaveBeenCalledTimes(4)
    act(() => result.current.reprobe())
    await settle()
    expect(fetch).toHaveBeenCalledTimes(6)
  })

  it('folds re-probes asked for while one runs into a single follow-up', async () => {
    const getMediaOrigins = mock(async () => ({ origins: [lan] }))
    const { result } = renderHook(() =>
      useMediaOriginProbe({
        isEnabled: true,
        api: { ...api, getMediaOrigins },
        fetch: answering(),
      }),
    )
    act(() => {
      result.current.reprobe()
      result.current.reprobe()
    })
    await settle()
    expect(getMediaOrigins).toHaveBeenCalledTimes(2)
  })

  it('re-probes on visibilitychange only after ten minutes hidden', async () => {
    const fetch = answering()
    renderHook(() =>
      useMediaOriginProbe({ isEnabled: true, api: clientWith({ origins: [lan, pub] }), fetch }),
    )
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
    renderHook(() => useMediaOriginProbe({ isEnabled: true, api: failing, fetch: answering() }))
    await settle()
    expect(useMediaOrigin.getState().pick?.origin ?? null).toEqual(lan)
    expect(useMediaOrigin.getState().isProbing).toBe(false)
  })

  it('runs once more after a probe in flight when a re-probe was asked for meanwhile', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let calls = 0
    const getMediaOrigins = mock(async () => {
      calls += 1
      if (calls === 1) await gate
      return { origins: [lan, pub] }
    })
    const fetch = answering()
    const { result } = renderHook(() =>
      useMediaOriginProbe({ isEnabled: true, api: { ...api, getMediaOrigins }, fetch }),
    )
    act(() => result.current.reprobe())
    await settle()
    expect(getMediaOrigins).toHaveBeenCalledTimes(1)
    release()
    await settle()
    expect(getMediaOrigins).toHaveBeenCalledTimes(2)
    expect(fetch).toHaveBeenCalledTimes(4)
    expect(useMediaOrigin.getState().isProbing).toBe(false)
  })

  it('counts a tab opened in the background as hidden from the start', async () => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    const fetch = answering()
    renderHook(() =>
      useMediaOriginProbe({ isEnabled: true, api: clientWith({ origins: [lan, pub] }), fetch }),
    )
    await settle()
    expect(fetch).toHaveBeenCalledTimes(2)
    setSystemTime(new Date(NOW + PICK_FRESH_MS))
    setVisibility('visible')
    await settle()
    expect(fetch).toHaveBeenCalledTimes(4)
  })

  it('stops listening on unmount', async () => {
    const fetch = answering()
    const { unmount } = renderHook(() =>
      useMediaOriginProbe({ isEnabled: true, api: clientWith({ origins: [lan, pub] }), fetch }),
    )
    await settle()
    unmount()
    fireEvent(window, new Event(PROBE_EVENTS.online))
    await settle()
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('probes nothing until it is enabled, then probes', async () => {
    const fetch = answering()
    const client = clientWith({ origins: [lan, pub] })
    const { rerender, result } = renderHook(
      ({ isEnabled }) => useMediaOriginProbe({ api: client, fetch, isEnabled }),
      { initialProps: { isEnabled: false } },
    )
    await settle()
    expect(client.getMediaOrigins).not.toHaveBeenCalled()

    act(() => result.current.reprobe())
    fireEvent(window, new Event(PROBE_EVENTS.online))
    await settle()
    expect(client.getMediaOrigins).not.toHaveBeenCalled()

    rerender({ isEnabled: true })
    await settle()
    expect(client.getMediaOrigins).toHaveBeenCalledTimes(1)
    expect(useMediaOrigin.getState().pick?.origin ?? null).toEqual(pub)
  })
})
