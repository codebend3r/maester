import { afterEach, describe, expect, it, jest, mock } from 'bun:test'
import { MEDIA_TICKET_REFRESH_SECONDS, MEDIA_TICKET_SECONDS, type MediaOrigin } from '@raven/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { useMediaPlane } from '@/components/Player/useMediaPlane'
import { playerQueriesFor } from '@/lib/playerQueries'
import { useMediaOrigin } from '@/stores/mediaOrigin'
import { api } from '@/test/api'

const lan: MediaOrigin = { kind: 'lan', url: 'https://lan.example' }
const publicOrigin: MediaOrigin = { kind: 'public', url: 'https://public.example' }
const REFRESH_MS = (MEDIA_TICKET_SECONDS - MEDIA_TICKET_REFRESH_SECONDS) * 1000

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

  it('refreshes the ticket from receipt, ten minutes before it would expire, whatever expiresAt says', async () => {
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
    expect(options.refetchInterval).toBe(REFRESH_MS)
    expect(options.refetchIntervalInBackground).toBe(true)
  })
})
