import { AuthApiError, isAuthSessionMissingError } from '@supabase/supabase-js'
import { createApiClient } from '@raven/core'
import { queryClient } from '@/lib/queryClient'
import { REFRESH_OUTCOMES, type RefreshOutcome, refreshingFetch } from '@/lib/refreshingFetch'
import { signOut } from '@/lib/signOut'
import { useAuthSession } from '@/stores/authSession'

/** The method a progress save goes by, which keeps it alive past the page closing. */
const METHODS = { put: 'PUT' } as const

const RATE_LIMITED_STATUS = 429

/** Supabase answered and refused the refresh token, as opposed to failing to answer. */
const isRefusedRefresh = (error: unknown): boolean =>
  isAuthSessionMissingError(error) ||
  (error instanceof AuthApiError &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== RATE_LIMITED_STATUS)

const refreshSession = async (): Promise<RefreshOutcome> => {
  const client = useAuthSession.getState().client
  if (client === null) return { kind: REFRESH_OUTCOMES.unreachable }
  try {
    const { data, error } = await client.refreshSession()
    if (data.session !== null) {
      return { kind: REFRESH_OUTCOMES.refreshed, accessToken: data.session.access_token }
    }
    return isRefusedRefresh(error)
      ? { kind: REFRESH_OUTCOMES.rejected }
      : { kind: REFRESH_OUTCOMES.unreachable }
  } catch {
    return { kind: REFRESH_OUTCOMES.unreachable }
  }
}

/**
 * Same origin in every setup: Docker serves this app from the media server,
 * and in development Vite proxies /api to it. Progress saves use keepalive
 * so the last one still lands when the player page is closing.
 */
export const api = createApiClient({
  accessToken: () => useAuthSession.getState().accessToken(),
  fetch: refreshingFetch({
    fetch: (url, init) => window.fetch(url, { ...init, keepalive: init?.method === METHODS.put }),
    accessToken: () => useAuthSession.getState().accessToken(),
    refresh: refreshSession,
    signOut: () => signOut({ queryClient }),
  }),
})
