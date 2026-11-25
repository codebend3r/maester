import { REFRESH_OUTCOMES, type RefreshOutcome } from '@raven/core'
import { HTTP_STATUSES } from '@shared/http'
import type { QueryClient } from '@tanstack/react-query'
import type { AuthClient } from '@/lib/authClient'
import { clearAccountState } from '@/lib/clearAccountState'
import { useAuthSession } from '@/stores/authSession'

const SIGN_OUT_SCOPES = { local: 'local' } as const

/*
 * Supabase answered and refused the refresh token, as opposed to failing to answer. Its error
 * classes load with its client, which is built before any refresh can run.
 */
const isRefusedRefresh = async (error: unknown): Promise<boolean> => {
  const { AuthApiError, isAuthSessionMissingError } = await import('@supabase/supabase-js')
  return (
    isAuthSessionMissingError(error) ||
    (error instanceof AuthApiError &&
      error.status >= 400 &&
      error.status < 500 &&
      error.status !== HTTP_STATUSES.tooManyRequests)
  )
}

/** Asks Supabase for a new access token, and says whether it came, was refused or went unanswered. */
export const refreshSession = async (): Promise<RefreshOutcome> => {
  const client = useAuthSession.getState().client
  if (client === null) return { kind: REFRESH_OUTCOMES.unreachable }
  try {
    const { data, error } = await client.refreshSession()
    if (data.session !== null) {
      return { kind: REFRESH_OUTCOMES.refreshed, accessToken: data.session.access_token }
    }
    return (await isRefusedRefresh(error))
      ? { kind: REFRESH_OUTCOMES.rejected }
      : { kind: REFRESH_OUTCOMES.unreachable }
  } catch {
    return { kind: REFRESH_OUTCOMES.unreachable }
  }
}

type SignOutProps = { queryClient: QueryClient }

type EndSessionProps = { client: AuthClient }

/** When Supabase cannot be reached its sign out keeps the session, so the local one is ended instead. */
const endSession = async ({ client }: EndSessionProps): Promise<void> => {
  const { error } = await client.signOut()
  if (error) await client.signOut({ scope: SIGN_OUT_SCOPES.local })
}

/** Ends the session, cookie and all, and empties what the account left behind: its answers and its queue. */
export const signOut = async ({ queryClient }: SignOutProps): Promise<void> => {
  const client = useAuthSession.getState().client
  if (client !== null) await endSession({ client })
  await clearAccountState({ queryClient })
}
