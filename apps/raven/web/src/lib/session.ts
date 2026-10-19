import { AuthApiError, isAuthSessionMissingError } from '@supabase/supabase-js'
import type { QueryClient } from '@tanstack/react-query'
import type { AuthClient } from '@/lib/authClient'
import { clearAccountState } from '@/lib/clearAccountState'
import { REFRESH_OUTCOMES, type RefreshOutcome } from '@/lib/refreshingFetch'
import { useAuthSession } from '@/stores/authSession'

const SIGN_OUT_SCOPES = { local: 'local' } as const

const RESEND_TYPES = { signup: 'signup' } as const

const RATE_LIMITED_STATUS = 429

/**
 * Runs `call` with the session's auth client and throws the error Supabase
 * answers with, which it returns rather than throws. Every form keeps its
 * submit off until the client is built, so the first throw is a backstop.
 */
export const callAuth = async <T extends { error: Error | null }>(
  call: (client: AuthClient) => Promise<T>,
): Promise<T> => {
  const client = useAuthSession.getState().client
  if (client === null) throw new Error('Accounts are not ready yet')
  const result = await call(client)
  if (result.error) throw result.error
  return result
}

/** Sends the email that confirms a new account's address again. */
export const resendConfirmation = ({ email }: { email: string }) =>
  callAuth((client) => client.resend({ type: RESEND_TYPES.signup, email }))

/** Supabase answered and refused the refresh token, as opposed to failing to answer. */
const isRefusedRefresh = (error: unknown): boolean =>
  isAuthSessionMissingError(error) ||
  (error instanceof AuthApiError &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== RATE_LIMITED_STATUS)

export const refreshSession = async (): Promise<RefreshOutcome> => {
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
 * Ends the session and empties what it left behind. When Supabase cannot be
 * reached its sign out keeps the session, so the local one is ended instead:
 * the cookie goes either way.
 */
export const signOut = async ({ queryClient }: { queryClient: QueryClient }): Promise<void> => {
  const client = useAuthSession.getState().client
  if (client !== null) {
    const { error } = await client.signOut()
    if (error) await client.signOut({ scope: SIGN_OUT_SCOPES.local })
  }
  await clearAccountState({ queryClient })
}
