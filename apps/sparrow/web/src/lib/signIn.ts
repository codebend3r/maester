import type { AuthError } from '@supabase/supabase-js'
import { useAuthSession } from '@/stores/authSession'

/** Why a sign-in failed: a field left empty, a wrong email or password, Supabase out of reach, or its own refusal. */
export const SIGN_IN_FAILURES = {
  missing: 'missing',
  badCredentials: 'badCredentials',
  unreachable: 'unreachable',
  refused: 'refused',
} as const

export type SignInFailure =
  | {
      kind: Exclude<
        (typeof SIGN_IN_FAILURES)[keyof typeof SIGN_IN_FAILURES],
        typeof SIGN_IN_FAILURES.refused
      >
    }
  | { kind: typeof SIGN_IN_FAILURES.refused; message: string }

/** Supabase Auth's error codes this page reads. */
const AUTH_ERROR_CODES = { invalidCredentials: 'invalid_credentials' } as const

const SIGN_OUT_SCOPES = { local: 'local' } as const

const UNREACHABLE = { kind: SIGN_IN_FAILURES.unreachable } as const

const failureOf = async (error: AuthError): Promise<SignInFailure> => {
  if (error.code === AUTH_ERROR_CODES.invalidCredentials)
    return { kind: SIGN_IN_FAILURES.badCredentials }
  // Its error classes load with its client, which answered before this runs.
  const { isAuthRetryableFetchError } = await import('@supabase/supabase-js')
  return isAuthRetryableFetchError(error)
    ? UNREACHABLE
    : { kind: SIGN_IN_FAILURES.refused, message: error.message }
}

type SignInProps = { email: string; password: string }

/** Signs the raven account in with its email and password; null once in, else why it failed. */
export const signIn = async ({ email, password }: SignInProps): Promise<SignInFailure | null> => {
  try {
    const client = await (useAuthSession.getState().clientLoad ?? Promise.resolve(null))
    if (client === null) return UNREACHABLE
    const { data, error } = await client.signInWithPassword({ email, password })
    if (error !== null) return await failureOf(error)
    useAuthSession.getState().take(data.session)
    return null
  } catch {
    return UNREACHABLE
  }
}

/** Ends the session; when Supabase can't be reached, the one kept in this browser is ended instead. */
export const signOut = async (): Promise<void> => {
  const client = await useAuthSession.getState().clientLoad
  if (client === null) return
  const { error } = await client.signOut()
  if (error !== null) await client.signOut({ scope: SIGN_OUT_SCOPES.local })
}
