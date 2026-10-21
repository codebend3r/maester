import { afterEach, describe, expect, it, jest } from 'bun:test'
import { QueryClient } from '@tanstack/react-query'
import { act, waitFor } from '@testing-library/react'
import { SERVER_EVENT_TYPES } from '@raven/core'
import { queryKeys } from '@/query/queryClient'
import {
  EVENTS_RETRY_MS,
  SERVER_STREAM_EVENTS,
  SERVER_STREAM_STATES,
  type ServerEventSource,
  serverEventsFor,
} from '@/query/useServerEvents'
import { recordingApi } from '@/test/recordingApi'
import { renderQueryHook } from '@/test/renderQueryHook'

type StreamEvent = Parameters<ServerEventSource['addEventListener']>[0]
type Listener = Parameters<ServerEventSource['addEventListener']>[1]

/** An event source that keeps its listeners, so a test can send what the server would. */
const fakeSource = (url: string) => {
  const listeners = new Map<StreamEvent, Listener[]>()
  const state: { closed: boolean; readyState: number } = {
    closed: false,
    readyState: SERVER_STREAM_STATES.connecting,
  }
  const source = {
    get readyState() {
      return state.readyState
    },
    addEventListener: (type: StreamEvent, listener: Listener) => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener])
    },
    close: () => {
      state.closed = true
    },
  } satisfies ServerEventSource
  const emit = ({ type, data }: { type: StreamEvent; data?: unknown }) =>
    (listeners.get(type) ?? []).forEach((listener) => listener({ data }))
  /** The source giving up, as a browser does when a reconnect is refused with a 401. */
  const end = () => {
    state.readyState = SERVER_STREAM_STATES.closed
    emit({ type: SERVER_STREAM_EVENTS.error })
  }
  return { url, source, state, emit, end }
}

/** One query under each key, none of them stale. */
const HELD = [
  queryKeys.libraries,
  queryKeys.library(2),
  queryKeys.library(3),
  queryKeys.favourites,
  queryKeys.item(40),
  queryKeys.home,
  queryKeys.mediaItem(7),
] as const

/** An access token a test changes by hand, as a sign in or a refresh would. */
const fakeTokens = () => {
  const listeners = new Set<(token: string | null) => void>()
  const onAccessTokenChange = (listener: (token: string | null) => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }
  const change = (token: string | null) =>
    act(() => listeners.forEach((listener) => listener(token)))
  return { onAccessTokenChange, change, listeners }
}

/** The hook mounted over a cache holding `HELD`, with every stream it opens kept. */
const setUp = ({ tokens }: { tokens?: ReturnType<typeof fakeTokens> } = {}) => {
  const { api } = recordingApi({ body: null })
  const opened: Array<ReturnType<typeof fakeSource>> = []
  const { useServerEvents } = serverEventsFor({
    api,
    openEvents: (url) => {
      const fake = fakeSource(url)
      opened.push(fake)
      return fake.source
    },
    onAccessTokenChange: tokens?.onAccessTokenChange,
  })
  const client = new QueryClient()
  HELD.forEach((key) => client.setQueryData(key, []))
  const hook = renderQueryHook({ client, hook: () => useServerEvents() })
  const stale = () => HELD.filter((key) => !!client.getQueryState(key)?.isInvalidated)
  return { api, hook, opened, stale }
}

describe('useServerEvents', () => {
  it("listens at the server's event address", () => {
    const { api, opened } = setUp()
    expect(opened.map(({ url }) => url)).toEqual([api.eventsUrl()])
  })

  it('reads again what a library event names, and nothing else', async () => {
    const { opened, stale } = setUp()
    opened[0]?.emit({
      type: SERVER_STREAM_EVENTS.message,
      data: JSON.stringify({ type: SERVER_EVENT_TYPES.library, libraryId: 2 }),
    })
    await waitFor(() =>
      expect(stale()).toEqual([
        queryKeys.libraries,
        queryKeys.library(2),
        queryKeys.favourites,
        queryKeys.item(40),
        queryKeys.home,
      ]),
    )
  })

  it('ignores a message that is not a server event', () => {
    const { opened, stale } = setUp()
    opened[0]?.emit({ type: SERVER_STREAM_EVENTS.message, data: 'not json' })
    opened[0]?.emit({
      type: SERVER_STREAM_EVENTS.message,
      data: { type: SERVER_EVENT_TYPES.library },
    })
    opened[0]?.emit({
      type: SERVER_STREAM_EVENTS.message,
      data: JSON.stringify({ type: 'rescan', libraryId: 2 }),
    })
    expect(stale()).toEqual([])
  })

  it('reads everything again once a dropped stream is back, not on its first open', async () => {
    const { opened, stale } = setUp()
    opened[0]?.emit({ type: SERVER_STREAM_EVENTS.open })
    expect(stale()).toEqual([])
    opened[0]?.emit({ type: SERVER_STREAM_EVENTS.error })
    expect(stale()).toEqual([])
    opened[0]?.emit({ type: SERVER_STREAM_EVENTS.open })
    await waitFor(() =>
      expect(stale()).toEqual([
        queryKeys.libraries,
        queryKeys.library(2),
        queryKeys.library(3),
        queryKeys.favourites,
        queryKeys.item(40),
        queryKeys.home,
      ]),
    )
  })

  it('hangs up when it unmounts', () => {
    const { hook, opened } = setUp()
    expect(opened[0]?.state.closed).toBe(false)
    hook.unmount()
    expect(opened.map(({ state }) => state.closed)).toEqual([true])
  })

  describe('when the source gives up', () => {
    afterEach(() => {
      jest.useRealTimers()
    })

    it('opens a new stream after EVENTS_RETRY_MS, and not before', () => {
      jest.useFakeTimers()
      const { opened } = setUp()
      opened[0]?.end()
      act(() => jest.advanceTimersByTime(EVENTS_RETRY_MS - 1))
      expect(opened).toHaveLength(1)
      act(() => jest.advanceTimersByTime(1))
      expect(opened).toHaveLength(2)
    })

    it('leaves a source that is still reconnecting to itself', () => {
      jest.useFakeTimers()
      const { opened } = setUp()
      opened[0]?.emit({ type: SERVER_STREAM_EVENTS.error })
      act(() => jest.advanceTimersByTime(EVENTS_RETRY_MS * 2))
      expect(opened).toHaveLength(1)
    })

    it('drops a waiting retry when it unmounts', () => {
      jest.useFakeTimers()
      const { hook, opened } = setUp()
      opened[0]?.end()
      hook.unmount()
      act(() => jest.advanceTimersByTime(EVENTS_RETRY_MS))
      expect(opened).toHaveLength(1)
    })
  })

  describe('with an access token', () => {
    it('replaces the open stream at once when the token changes, and reads everything again once it opens', async () => {
      const tokens = fakeTokens()
      const { opened, stale } = setUp({ tokens })
      tokens.change('refreshed')
      expect(opened.map(({ state }) => state.closed)).toEqual([true, false])
      expect(stale()).toEqual([])
      opened[1]?.emit({ type: SERVER_STREAM_EVENTS.open })
      await waitFor(() => expect(stale()).toHaveLength(HELD.length - 1))
    })

    it('closes the stream on sign out and opens none until someone signs in', () => {
      const tokens = fakeTokens()
      const { opened } = setUp({ tokens })
      tokens.change(null)
      expect(opened.map(({ state }) => state.closed)).toEqual([true])
      tokens.change('signed-in')
      expect(opened.map(({ state }) => state.closed)).toEqual([true, false])
    })

    it('stops listening for the token when it unmounts', () => {
      const tokens = fakeTokens()
      const { hook } = setUp({ tokens })
      expect(tokens.listeners.size).toBe(1)
      hook.unmount()
      expect(tokens.listeners.size).toBe(0)
    })
  })
})
