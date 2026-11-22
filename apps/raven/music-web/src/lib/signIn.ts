import type { AuthError } from '@supabase/supabase-js'
import { AUTH_CONFIG_STATES, AUTH_ERROR_CODES, SIGN_IN_ERRORS, type SignInError } from '@raven/core'
import { queries } from '@/lib/queries'
import { queryClient } from '@/lib/queryClient'
import { useAuthSession } from '@/stores/authSession'

const UNREACHABLE = { kind: SIGN_IN_ERRORS.unreachable } as const

/*
 * Supabase's answer to a failed sign-in, as the error Wren says, in the apps' kinds. Their `full`
 * and `notAdded` are of their server list, which the web has none of, so it never says them.
 */
const failureOf = async (error: AuthError): Promise<SignInError> => {
  if (error.code === AUTH_ERROR_CODES.invalidCredentials) {
    return { kind: SIGN_IN_ERRORS.badCredentials }
  }
  // Its error classes load with its client, which answered before this runs.
  const { isAuthRetryableFetchError } = await import('@supabase/supabase-js')
  return isAuthRetryableFetchError(error)
    ? UNREACHABLE
    : { kind: SIGN_IN_ERRORS.refused, message: error.message }
}

/*
 * The auth client, asked for through the server's config: read again when the last read failed,
 * so a sign-in pressed once raven is back in reach goes through. Null when raven or its accounts
 * cannot be reached.
 */
const authClient = async () => {
  const config = await queryClient.fetchQuery(queries.authConfigQuery).catch(() => null)
  if (config === null || config.state !== AUTH_CONFIG_STATES.ready) return null
  return useAuthSession.getState().start({ config })
}

type SignInProps = { email: string; password: string }

/** Signs the raven account in with its email and password; null once in, else why it failed. */
export const signIn = async ({ email, password }: SignInProps): Promise<SignInError | null> => {
  try {
    const client = await authClient()
    if (client === null) return UNREACHABLE
    const { data, error } = await client.signInWithPassword({ email, password })
    if (error !== null) return await failureOf(error)
    useAuthSession.getState().take(data.session)
    return null
  } catch {
    return UNREACHABLE
  }
}
