import { afterEach, beforeEach, describe, expect, it, jest } from 'bun:test'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { EVENT_SOURCE_EVENTS } from '@/lib/eventSourceEvents'
import { EVENTS_RETRY_MS, useServerEvents } from '@/lib/useServerEvents'
import { useAuthSession } from '@/stores/authSession'
import { SIGNED_IN } from '@/test/authClient'
import { FakeEventSource } from '@/test/eventSource'

const render = () => {
  const client = new QueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, ...renderHook(() => useServerEvents(), { wrapper }) }
}

/** The stream the page opened `index`th, failing the test when there is none. */
const stream = (index: number): FakeEventSource => {
  const opened = FakeEventSource.opened[index]
  if (!opened) throw new Error(`No stream ${index} was opened`)
  return opened
}

const refreshToken = () =>
  act(() => useAuthSession.setState({ session: { ...SIGNED_IN, accessToken: 'refreshed' } }))

describe('useServerEvents', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    useAuthSession.setState({ session: SIGNED_IN })
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('opens a new stream after the browser gives up on one, and not before', () => {
    render()
    expect(FakeEventSource.opened).toHaveLength(1)

    stream(0).end()
    act(() => jest.advanceTimersByTime(EVENTS_RETRY_MS - 1))
    expect(FakeEventSource.opened).toHaveLength(1)
    act(() => jest.advanceTimersByTime(1))
    expect(FakeEventSource.opened).toHaveLength(2)
  })

  it('keeps trying while every new stream is refused', () => {
    render()
    stream(0).end()
    act(() => jest.advanceTimersByTime(EVENTS_RETRY_MS))
    stream(1).end()
    act(() => jest.advanceTimersByTime(EVENTS_RETRY_MS))
    expect(FakeEventSource.opened).toHaveLength(3)
  })

  it('reads the pages again once the stream it reopened is open, for what it missed', () => {
    const { client } = render()
    const invalidate = jest.spyOn(client, 'invalidateQueries').mockResolvedValue()
    stream(0).end()
    act(() => jest.advanceTimersByTime(EVENTS_RETRY_MS))
    expect(invalidate).not.toHaveBeenCalled()

    act(() => {
      stream(1).dispatchEvent(new Event(EVENT_SOURCE_EVENTS.open))
    })
    expect(invalidate).toHaveBeenCalled()
  })

  it('leaves a stream the browser is still retrying to the browser', () => {
    render()
    stream(0).reconnect()
    act(() => jest.advanceTimersByTime(EVENTS_RETRY_MS * 2))
    expect(FakeEventSource.opened).toHaveLength(1)
  })

  it('replaces the open stream at once when the access token changes', () => {
    render()
    const first = stream(0)
    refreshToken()
    expect(first.closed).toBe(true)
    expect(FakeEventSource.opened).toHaveLength(2)
    expect(stream(1).closed).toBe(false)
  })

  it('drops a retry that is waiting when the token changes, or the page goes', () => {
    const { unmount } = render()
    stream(0).end()
    refreshToken()
    expect(FakeEventSource.opened).toHaveLength(2)
    act(() => jest.advanceTimersByTime(EVENTS_RETRY_MS))
    expect(FakeEventSource.opened).toHaveLength(2)

    stream(1).end()
    unmount()
    act(() => jest.advanceTimersByTime(EVENTS_RETRY_MS))
    expect(FakeEventSource.opened).toHaveLength(2)
    expect(stream(1).closed).toBe(true)
  })

  it('reads the pages again once the stream opened for a new token is open, for what came in between', () => {
    const { client } = render()
    const invalidate = jest.spyOn(client, 'invalidateQueries').mockResolvedValue()
    refreshToken()
    expect(invalidate).not.toHaveBeenCalled()

    act(() => {
      stream(1).dispatchEvent(new Event(EVENT_SOURCE_EVENTS.open))
    })
    expect(invalidate).toHaveBeenCalled()
  })

  it('closes the stream on sign out and opens none until someone signs in', () => {
    render()
    stream(0).end()
    act(() => useAuthSession.setState({ session: null }))
    expect(stream(0).closed).toBe(true)
    act(() => jest.advanceTimersByTime(EVENTS_RETRY_MS * 2))
    expect(FakeEventSource.opened).toHaveLength(1)

    act(() => useAuthSession.setState({ session: SIGNED_IN }))
    expect(FakeEventSource.opened).toHaveLength(2)
    expect(stream(1).closed).toBe(false)
  })
})
