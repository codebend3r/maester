import { createApiClient } from '@weirwood/core'

/**
 * Same origin in every setup: Docker serves this app from the media server,
 * and in development Vite proxies /api to it. Progress saves use keepalive
 * so the last one still lands when the player page is closing.
 */
export const api = createApiClient({
  fetch: (url, init) => window.fetch(url, { ...init, keepalive: init?.method === 'PUT' }),
})
