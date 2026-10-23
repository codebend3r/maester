import { type QueryClient, useQueryClient } from '@tanstack/react-query'
import { type ApiClient, SERVER_EVENT_TYPES, type ServerEvent, parseServerEvent } from '@raven/core'
import { useEffect } from 'react'
import { afterLibraryEvent, afterReconnect } from '@/query/invalidate'

/** What an event stream says happened to it, as `EventSource` names it. */
export const SERVER_STREAM_EVENTS = { message: 'message', error: 'error', open: 'open' } as const

/** The states an event stream is in, with `EventSource`'s `readyState` values. */
export const SERVER_STREAM_STATES = { connecting: 0, open: 1, closed: 2 } as const

type ServerStreamEvent = (typeof SERVER_STREAM_EVENTS)[keyof typeof SERVER_STREAM_EVENTS]

/**
 * The part of an `EventSource` the hook uses, so each platform hands in its
 * own: the browser's, or a library's where there is none. A message's
 * `data` is checked before it is trusted, since the stream is the network.
 * `readyState` is `SERVER_STREAM_STATES.closed` once the source has given up
 * and will not reconnect on its own.
 */
export type ServerEventSource = {
  addEventListener: (type: ServerStreamEvent, listener: (event: { data: unknown }) => void) => void
  close: () => void
  readonly readyState: number
}

/**
 * How long after a source gives up on the stream a new one is opened. The
 * server ends a stream when the account loses access or the token expires,
 * and a reconnect it refuses with a 401 leaves the browser's `EventSource`
 * closed for good, so this opens another with whatever credentials are there then.
 */
export const EVENTS_RETRY_MS = 5_000

/** Reads again what an event says changed. */
const follow = ({
  queryClient,
  event,
}: {
  queryClient: QueryClient
  event: ServerEvent
}): Promise<unknown> => {
  switch (event.type) {
    case SERVER_EVENT_TYPES.library:
      return afterLibraryEvent({ queryClient, libraryId: event.libraryId })
    default: {
      const unknown: never = event.type
      return Promise.resolve(unknown)
    }
  }
}

type Connection = {
  source: ServerEventSource | null
  retry: ReturnType<typeof setTimeout> | null
  isDropped: boolean
}

/** Calls the listener with the access token each time it changes, null on sign out; returns the unsubscribe. */
type AccessTokenChanges = (listener: (token: string | null) => void) => () => void

/** A host with no access token, whose stream rides cookies alone. */
const NO_ACCESS_TOKEN: AccessTokenChanges = () => () => undefined

/**
 * The server-event hook over one server's `api`, listening on what
 * `openEvents` opens at its event address. A host whose stream travels with
 * an access token passes `onAccessTokenChange`, so a new token replaces the
 * open stream and signing out closes it.
 */
export const serverEventsFor = ({
  api,
  openEvents,
  onAccessTokenChange = NO_ACCESS_TOKEN,
}: {
  api: ApiClient
  openEvents: (url: string) => ServerEventSource
  onAccessTokenChange?: AccessTokenChanges
}) => {
  /**
   * Keeps the browsing pages in step with the server as it changes: a
   * library whose folders changed is read again, its listings and counts
   * with it, and whatever pages and favourites its videos show on. The
   * source reconnects on its own when the stream drops, and everything is
   * read again once it is back, for the changes sent while it was down. A
   * stream the source closed is opened again after `EVENTS_RETRY_MS`, and a
   * new access token replaces the open one at once, reading everything again
   * once it opens for what came in between. Signing out closes the stream
   * until someone signs in.
   */
  const useServerEvents = (): void => {
    const queryClient = useQueryClient()
    useEffect(() => {
      const connection: Connection = { source: null, retry: null, isDropped: false }
      const close = (): void => {
        connection.source?.close()
        connection.source = null
        if (connection.retry !== null) clearTimeout(connection.retry)
        connection.retry = null
      }
      const open = (): void => {
        const source = openEvents(api.eventsUrl())
        connection.source = source
        source.addEventListener(SERVER_STREAM_EVENTS.message, ({ data }) => {
          const event = typeof data === 'string' ? parseServerEvent(data) : null
          // A read that fails shows on its own query.
          if (event) follow({ queryClient, event }).catch(() => undefined)
        })
        source.addEventListener(SERVER_STREAM_EVENTS.error, () => {
          connection.isDropped = true
          if (source.readyState !== SERVER_STREAM_STATES.closed) return
          connection.retry = setTimeout(open, EVENTS_RETRY_MS)
        })
        source.addEventListener(SERVER_STREAM_EVENTS.open, () => {
          if (connection.isDropped) afterReconnect(queryClient).catch(() => undefined)
          connection.isDropped = false
        })
      }
      open()
      const unsubscribe = onAccessTokenChange((token) => {
        close()
        if (token === null) return
        connection.isDropped = true
        open()
      })
      return () => {
        unsubscribe()
        close()
      }
    }, [queryClient])
  }
  return { useServerEvents }
}
