import { useQueryClient } from '@tanstack/react-query'
import { type ServerEvent, parseServerEvent } from '@raven/core'
import { useEffect } from 'react'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/queryClient'

/**
 * Keeps the browsing pages in step with the server as it changes: a library
 * whose folders changed is read again, its listings and counts with it, and
 * whatever pages and favourites its videos show on. The browser reconnects
 * on its own when the stream drops.
 */
export const useServerEvents = (): void => {
  const queryClient = useQueryClient()
  useEffect(() => {
    const onEvent = (event: ServerEvent): Promise<unknown> => {
      switch (event.type) {
        case 'library':
          return Promise.all([
            queryClient.invalidateQueries({ queryKey: queryKeys.library(event.libraryId) }),
            queryClient.invalidateQueries({ queryKey: queryKeys.libraries, exact: true }),
            queryClient.invalidateQueries({ queryKey: queryKeys.favourites }),
            queryClient.invalidateQueries({ queryKey: queryKeys.items }),
          ])
        default: {
          const unknown: never = event.type
          return Promise.resolve(unknown)
        }
      }
    }
    const source = new EventSource(api.eventsUrl())
    source.addEventListener('message', (message: MessageEvent<unknown>) => {
      const event = typeof message.data === 'string' ? parseServerEvent(message.data) : null
      if (event) void onEvent(event)
    })
    return () => source.close()
  }, [queryClient])
}
