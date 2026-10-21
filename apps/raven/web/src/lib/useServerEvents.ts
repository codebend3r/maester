import { type QueryClient, useQueryClient } from '@tanstack/react-query'
import { SERVER_EVENT_TYPES, type ServerEvent, parseServerEvent } from '@raven/core'
import { useEffect } from 'react'
import { api } from '@/lib/api'
import { EVENT_SOURCE_EVENTS } from '@/lib/eventSourceEvents'
import { afterLibraryEvent, afterReconnect } from '@raven/ui/headless'
import { onAccessTokenChange } from '@/stores/authSession'

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

/**
 * How long after the browser gives up on the stream a new one is opened. The
 * server ends a stream when the account loses access or the token expires,
 * and a reconnect it refuses with a 401 leaves the browser's `EventSource`
 * closed for good, so this opens another with whatever cookie is there then.
 */
export const EVENTS_RETRY_MS = 5_000

type Connection = {
  source: EventSource | null
  retry: ReturnType<typeof setTimeout> | null
  isDropped: boolean
}

/**
 * Keeps the browsing pages in step with the server as it changes: a library
 * whose folders changed is read again, its listings and counts with it, and
 * whatever pages and favourites its videos show on. The browser reconnects
 * on its own when the stream drops, and everything is read again once it
 * is back, for the changes sent while it was down. A stream the browser
 * closed is opened again after `EVENTS_RETRY_MS`, and a new access token
 * replaces the open one at once, as the cookie it travels in is the new one,
 * reading everything again once it opens for what came in between. Signing
 * out closes the stream until someone signs in.
 */
export const useServerEvents = (): void => {
  const queryClient = useQueryClient()
  useEffect(() => {
    const connection: Connection = { source: null, retry: null, isDropped: false }
    const close = (): void => {
      if (connection.source !== null) connection.source.close()
      connection.source = null
      if (connection.retry !== null) clearTimeout(connection.retry)
      connection.retry = null
    }
    const open = (): void => {
      const source = new EventSource(api.eventsUrl())
      connection.source = source
      source.addEventListener(EVENT_SOURCE_EVENTS.message, (message: MessageEvent<unknown>) => {
        const event = typeof message.data === 'string' ? parseServerEvent(message.data) : null
        if (event) follow({ queryClient, event }).catch(() => undefined)
      })
      source.addEventListener(EVENT_SOURCE_EVENTS.error, () => {
        connection.isDropped = true
        if (source.readyState !== EventSource.CLOSED) return
        connection.retry = setTimeout(open, EVENTS_RETRY_MS)
      })
      source.addEventListener(EVENT_SOURCE_EVENTS.open, () => {
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
