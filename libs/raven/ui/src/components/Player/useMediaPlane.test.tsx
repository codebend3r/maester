import { afterEach, describe, expect, it, jest, mock } from 'bun:test'
import type { MediaOrigin } from '@raven/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { useMediaPlane } from '@/components/Player/useMediaPlane'
import { playerQueriesFor } from '@/lib/playerQueries'
import { useMediaOrigin } from '@/stores/mediaOrigin'
import { api } from '@/test/api'

const lan: MediaOrigin = { kind: 'lan', url: 'https://lan.example' }
const publicOrigin: MediaOrigin = { kind: 'public', url: 'https://public.example' }
/** Every two minutes, as the README says the page renews an account ticket. */
const REFRESH_MS = 2 * 60_000

const apiWithTickets = (getMediaTicket: typeof api.getMediaTicket) => ({ ...api, getMediaTicket })

const harness = ({ client = new QueryClient() }: { client?: QueryClient } = {}) => {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return Wrapper
}

const pickOrigin = (origin: MediaOrigin) =>
  act(() => useMediaOrigin.getState().setPick({ origin, at: Date.now() }))

const flushMicrotasks = () => new Promise<void>((resolve) => queueMicrotask(resolve))

/** TanStack hands its notifications to a zero timer, so flush it as well as the promises. */
const advance = (ms: number) =>
  act(async () => {
    jest.advanceTimersByTime(ms)
    await flushMicrotasks()
    jest.advanceTimersByTime(0)
    await flushMicrotasks()
  })

afterEach(() => {
  jest.useRealTimers()
})

describe('useMediaPlane', () => {
  it('has no access without a pick and never asks for a ticket', async () => {
    const getMediaTicket = mock(async () => ({ ticket: 't1', expiresAt: 0 }))
    const { result } = renderHook(
      () => useMediaPlane({ api: apiWithTickets(getMediaTicket), mediaId: 1, reprobe: () => {} }),
      { wrapper: harness() },
    )
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.access).toBeNull()
    expect(getMediaTicket).not.toHaveBeenCalled()
  })

  it('has access once the pick and the ticket are in, and keeps its identity until either changes', async () => {
    let issued = 0
    const getMediaTicket = mock(async () => ({ ticket: `t${++issued}`, expiresAt: 0 }))
    const client = new QueryClient()
    const { result, rerender } = renderHook(
      () => useMediaPlane({ api: apiWithTickets(getMediaTicket), mediaId: 1, reprobe: () => {} }),
      { wrapper: harness({ client }) },
    )
    pickOrigin(lan)
    await waitFor(() => expect(result.current.access).toEqual({ origin: lan, ticket: 't1' }))
    expect(getMediaTicket).toHaveBeenCalledWith(1)
    const first = result.current.access
    rerender()
    expect(result.current.access).toBe(first)
    pickOrigin({ ...lan })
    expect(result.current.access).toBe(first)
    pickOrigin(publicOrigin)
    expect(result.current.access).toEqual({ origin: publicOrigin, ticket: 't1' })
    act(() => useMediaOrigin.getState().setPick(null))
    expect(result.current.access).toBeNull()
  })

  it("refreshes the ticket from receipt, inside an account ticket's life, whatever expiresAt says", async () => {
    jest.useFakeTimers()
    let issued = 0
    const getMediaTicket = mock(async () => ({ ticket: `t${++issued}`, expiresAt: 1 }))
    const { result } = renderHook(
      () => useMediaPlane({ api: apiWithTickets(getMediaTicket), mediaId: 1, reprobe: () => {} }),
      { wrapper: harness() },
    )
    pickOrigin(lan)
    await advance(0)
    expect(getMediaTicket).toHaveBeenCalledTimes(1)
    await advance(REFRESH_MS - 1000)
    expect(getMediaTicket).toHaveBeenCalledTimes(1)
    await advance(2000)
    expect(getMediaTicket).toHaveBeenCalledTimes(2)
    expect(result.current.access?.ticket).toBe('t2')
  })

  it("counts the refresh from the ticket's arrival across a remount, not from the remount", async () => {
    jest.useFakeTimers()
    let issued = 0
    const getMediaTicket = mock(async () => ({ ticket: `t${++issued}`, expiresAt: 1 }))
    const client = new QueryClient()
    const mount = () =>
      renderHook(
        () => useMediaPlane({ api: apiWithTickets(getMediaTicket), mediaId: 1, reprobe: () => {} }),
        { wrapper: harness({ client }) },
      )
    const elapsedBeforeUnmount = 60_000
    const unmountedFor = 20_000
    const first = mount()
    pickOrigin(lan)
    await advance(0)
    expect(getMediaTicket).toHaveBeenCalledTimes(1)
    await advance(elapsedBeforeUnmount)
    first.unmount()
    await advance(unmountedFor)
    mount()
    await advance(0)
    expect(getMediaTicket).toHaveBeenCalledTimes(1)
    await advance(REFRESH_MS - elapsedBeforeUnmount - unmountedFor - 1000)
    expect(getMediaTicket).toHaveBeenCalledTimes(1)
    await advance(2000)
    expect(getMediaTicket).toHaveBeenCalledTimes(2)
  })

  it('retries a refused refresh a minute later, not a second later', async () => {
    jest.useFakeTimers()
    let isRefusing = false
    const getMediaTicket = mock(async () => {
      if (isRefusing) throw new Error('locked')
      return { ticket: 'fine', expiresAt: 1 }
    })
    const { result } = renderHook(
      () => useMediaPlane({ api: apiWithTickets(getMediaTicket), mediaId: 1, reprobe: () => {} }),
      { wrapper: harness() },
    )
    pickOrigin(lan)
    await advance(0)
    isRefusing = true
    await advance(REFRESH_MS + 1000)
    expect(getMediaTicket).toHaveBeenCalledTimes(2)
    await advance(59_000)
    expect(getMediaTicket).toHaveBeenCalledTimes(2)
    await advance(2000)
    expect(getMediaTicket).toHaveBeenCalledTimes(3)
    expect(result.current.access?.ticket).toBe('fine')
  })

  it('retries a refused first ticket a minute later, not after the full refresh wait', async () => {
    jest.useFakeTimers()
    let isRefusing = true
    const getMediaTicket = mock(async () => {
      if (isRefusing) throw new Error('locked')
      return { ticket: 'fine', expiresAt: 1 }
    })
    const { result } = renderHook(
      () => useMediaPlane({ api: apiWithTickets(getMediaTicket), mediaId: 1, reprobe: () => {} }),
      { wrapper: harness() },
    )
    pickOrigin(lan)
    await advance(0)
    expect(getMediaTicket).toHaveBeenCalledTimes(1)
    expect(result.current.access).toBeNull()
    isRefusing = false
    await advance(59_000)
    expect(getMediaTicket).toHaveBeenCalledTimes(1)
    await advance(2000)
    expect(getMediaTicket).toHaveBeenCalledTimes(2)
    expect(result.current.access?.ticket).toBe('fine')
  })

  it('refreshTicket answers whether the server gave a new ticket', async () => {
    let isRefusing = false
    const getMediaTicket = mock(async () => {
      if (isRefusing) throw new Error('refused')
      return { ticket: 'fine', expiresAt: 0 }
    })
    const { result } = renderHook(
      () => useMediaPlane({ api: apiWithTickets(getMediaTicket), mediaId: 1, reprobe: () => {} }),
      { wrapper: harness() },
    )
    pickOrigin(lan)
    await waitFor(() => expect(result.current.access?.ticket).toBe('fine'))
    expect(await result.current.refreshTicket()).toBe(true)
    isRefusing = true
    expect(await result.current.refreshTicket()).toBe(false)
  })

  it('reportUnreachable asks for a new probe', () => {
    const reprobe = mock(() => {})
    const { result } = renderHook(() => useMediaPlane({ api, mediaId: 1, reprobe }), {
      wrapper: harness(),
    })
    result.current.reportUnreachable()
    expect(reprobe).toHaveBeenCalledTimes(1)
  })
})

describe('mediaTicket query', () => {
  it('is fetched once and refetched on a timer from receipt, never as stale', () => {
    const options = playerQueriesFor(api).mediaTicket(1)
    expect(options.staleTime).toBe(Infinity)
    expect(options.retry).toBe(false)
    expect(typeof options.refetchInterval).toBe('function')
    expect(options.refetchIntervalInBackground).toBe(true)
  })
})
