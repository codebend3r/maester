import type { SupabaseClient } from '@supabase/supabase-js'
import { AUTH_CONFIG_STATES, type AuthConfig } from '@raven/core'

export const AUTH_EVENTS = { passwordRecovery: 'PASSWORD_RECOVERY' } as const

export type ReadyAuthConfig = Extract<AuthConfig, { state: typeof AUTH_CONFIG_STATES.ready }>

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

type HasSessionCookieProps = {
  /** `document.cookie`. */
  cookies: string
  cookieName: string
}

/**
 * Whether the browser holds a Supabase session at all: Supabase keeps it in the cookie the config
 * names, split into `<name>.0`, `<name>.1` and on when it is long. Without one nobody is signed in,
 * which the app can say before Supabase's code has loaded.
 */
export const hasSessionCookie = ({ cookies, cookieName }: HasSessionCookieProps): boolean =>
  cookies.split(';').some((cookie) => {
    const name = cookie.trim().split('=')[0] ?? ''
    return name === cookieName || name.startsWith(`${cookieName}.`)
  })
