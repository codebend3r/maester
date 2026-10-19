import { createApiClient } from '@raven/core'
import { queryClient } from '@/lib/queryClient'
import { refreshingFetch } from '@/lib/refreshingFetch'
import { refreshSession, signOut } from '@/lib/session'
import { useAuthSession } from '@/stores/authSession'

/** The method a progress save goes by, which keeps it alive past the page closing. */
const METHODS = { put: 'PUT' } as const

const accessToken = (): string | null => useAuthSession.getState().session?.accessToken ?? null

/**
 * Same origin in every setup: Docker serves this app from the media server,
 * and in development Vite proxies /api to it. Progress saves use keepalive
 * so the last one still lands when the player page is closing.
 */
export const api = createApiClient({
  accessToken,
  fetch: refreshingFetch({
    fetch: (url, init) => window.fetch(url, { ...init, keepalive: init?.method === METHODS.put }),
    accessToken,
    refresh: refreshSession,
    signOut: () => signOut({ queryClient }),
  }),
})
