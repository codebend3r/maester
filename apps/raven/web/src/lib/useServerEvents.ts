import { type QueryClient, useQueryClient } from '@tanstack/react-query'
import { type ServerEvent, parseServerEvent } from '@raven/core'
import { useEffect } from 'react'
import { api } from '@/lib/api'
import { afterLibraryEvent, afterReconnect } from '@/lib/invalidate'

/** Reads again what an event says changed. */
const follow = ({
  queryClient,
  event,
}: {
  queryClient: QueryClient
  event: ServerEvent
}): Promise<unknown> => {
  switch (event.type) {
    case 'library':
      return afterLibraryEvent({ queryClient, libraryId: event.libraryId })
    default: {
      const unknown: never = event.type
      return Promise.resolve(unknown)
    }
  }
}

/**
 * Keeps the browsing pages in step with the server as it changes: a library
 * whose folders changed is read again, its listings and counts with it, and
 * whatever pages and favourites its videos show on. The browser reconnects
 * on its own when the stream drops, and everything is read again once it
 * is back, for the changes sent while it was down.
 */
export const useServerEvents = (): void => {
  const queryClient = useQueryClient()
  useEffect(() => {
    const source = new EventSource(api.eventsUrl())
    const stream = { dropped: false }
    source.addEventListener('message', (message: MessageEvent<unknown>) => {
      const event = typeof message.data === 'string' ? parseServerEvent(message.data) : null
      if (event) void follow({ queryClient, event })
    })
    source.addEventListener('error', () => {
      stream.dropped = true
    })
    source.addEventListener('open', () => {
      if (stream.dropped) void afterReconnect(queryClient)
      stream.dropped = false
    })
    return () => source.close()
  }, [queryClient])
}
