import { HTTP_METHODS, createApiClient, refreshingFetch } from '@raven/core'
import { queryClient } from '@/lib/queryClient'
import { refreshSession, signOut } from '@/lib/session'
import { useAuthSession } from '@/stores/authSession'

const accessToken = (): string | null => useAuthSession.getState().session?.accessToken ?? null

/**
 * raven, on the page's own origin in every setup: raven serves the app itself, Vite proxies /api
 * to it in development, and Netlify proxies it in production. Every call carries the session's
 * token and is repeated once after a refresh when the server says it has expired. A save, an
 * audiobook's spot among them, uses keepalive, so the last one still lands as the page closes.
 * A build for Netlify names its Image CDN, which pictures then go through.
 */
export const api = createApiClient({
  accessToken,
  // Unset and '' alike mean no CDN.
  pictureCdn: import.meta.env.VITE_PICTURE_CDN || null,
  fetch: refreshingFetch({
    fetch: (url, init) =>
      window.fetch(url, { ...init, keepalive: (init?.method ?? null) === HTTP_METHODS.put }),
    accessToken,
    refresh: refreshSession,
    signOut: () => signOut({ queryClient }),
  }),
})
