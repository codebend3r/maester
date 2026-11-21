import type { SupabaseClient } from '@supabase/supabase-js'
import type { ReadyAuthConfig } from '@raven/core'

export const AUTH_EVENTS = { passwordRecovery: 'PASSWORD_RECOVERY' } as const

export type AuthClient = Pick<
  SupabaseClient['auth'],
  | 'signInWithPassword'
  | 'signUp'
  | 'signOut'
  | 'resend'
  | 'resetPasswordForEmail'
  | 'updateUser'
  | 'verifyOtp'
  | 'refreshSession'
  | 'getSession'
  | 'onAuthStateChange'
>

type CreateAuthClientProps = { config: ReadyAuthConfig }

/**
 * Builds the client, loading Supabase's code only now: it is the biggest part of what a first
 * visit would otherwise download before the sign-in page draws.
 */
export const createAuthClient = async ({ config }: CreateAuthClientProps): Promise<AuthClient> => {
  const { createBrowserClient } = await import('@supabase/ssr')
  return createBrowserClient(config.supabaseUrl, config.publishableKey, {
    cookieOptions: { name: config.cookieName, sameSite: 'lax', path: '/' },
  }).auth
}
