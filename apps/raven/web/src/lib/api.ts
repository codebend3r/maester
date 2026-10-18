import { createApiClient } from '@raven/core'
import { useAuthSession } from '@/stores/authSession'

/** The method a progress save goes by, which keeps it alive past the page closing. */
const METHODS = { put: 'PUT' } as const

/**
 * Same origin in every setup: Docker serves this app from the media server,
 * and in development Vite proxies /api to it. Progress saves use keepalive
 * so the last one still lands when the player page is closing.
 */
export const api = createApiClient({
  accessToken: () => useAuthSession.getState().accessToken(),
  fetch: (url, init) => window.fetch(url, { ...init, keepalive: init?.method === METHODS.put }),
})
