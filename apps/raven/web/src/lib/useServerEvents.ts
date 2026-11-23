import { fetchEventSource, useToasts } from '@raven/ui'
import { onActiveServerChange, serverEventsFor, useActiveServer } from '@raven/ui/headless'
import { api } from '@/lib/api'
import { currentAccessToken, onAccessTokenChange } from '@/stores/authSession'

/**
 * The home server's stream is the page's own `/api/events`, which `EventSource` opens with the
 * session's cookie. Another server's is at its origin, where the page has no cookie, so it is
 * read through `fetch` with the Bearer instead.
 */
const openEvents = (url: string) =>
  useActiveServer.getState().active === null
    ? new EventSource(url)
    : fetchEventSource({ url, accessToken: currentAccessToken() })

export const { useServerEvents } = serverEventsFor({
  api,
  openEvents,
  onAccessTokenChange,
  onServerChange: onActiveServerChange,
  onNotification: (notification) => useToasts.getState().showNotification(notification),
})
