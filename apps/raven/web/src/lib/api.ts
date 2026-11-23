import { createApiClient, refreshingFetch } from '@raven/core'
import { serverClientsFor } from '@raven/ui/headless'
import { isRelayedByMain, mainOnActiveServer } from '@/desktop/servers'
import { queryClient } from '@/lib/queryClient'
import { refreshSession, signOut } from '@/lib/session'
import { currentAccessToken } from '@/stores/authSession'

/** The method a progress save goes by, which keeps it alive past the page closing. */
const METHODS = { put: 'PUT' } as const

/**
 * `api` talks to the active server (`useActiveServer`): the page's own `/api` for the home one,
 * which Docker serves from the media server, Vite proxies in development and Netlify proxies to
 * raven, and another server's own origin, with the Bearer and no cookie, once the viewer
 * switches to it. Progress saves use keepalive so the last one still lands when the player page
 * is closing. A build for Netlify names its Image CDN, which the home server's pictures then go
 * through. `apiAt` is one server's own client, for what the page reads of a server it is not
 * using. Inside Raven the page's `/api` is main's relay to the server in use, so `api` calls it for
 * every server, each call once main says it uses the page's active one.
 */
export const { active: api, at: apiAt } = serverClientsFor({
  accessToken: currentAccessToken,
  // Unset and '' alike mean no CDN.
  pictureCdn: import.meta.env.VITE_PICTURE_CDN || null,
  isRelayed: isRelayedByMain,
  fetch: refreshingFetch({
    fetch: async (url, init) => {
      await mainOnActiveServer()
      return window.fetch(url, { ...init, keepalive: (init?.method ?? null) === METHODS.put })
    },
    accessToken: currentAccessToken,
    refresh: refreshSession,
    signOut: () => signOut({ queryClient }),
  }),
})

/**
 * The home server's own `/api`, whichever server is active: the account config the session
 * is built from, and the home server's id, are always its.
 */
export const homeApi = createApiClient({
  accessToken: currentAccessToken,
  fetch: (url, init) => window.fetch(url, init),
})
