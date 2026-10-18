import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import { AUTH_CONFIG_STATES, type AuthConfig } from '@raven/core'

export const AUTH_ERRORS = {
  invalidCredentials: 'invalid_credentials',
  emailNotConfirmed: 'email_not_confirmed',
  userAlreadyExists: 'user_already_exists',
  otpExpired: 'otp_expired',
  overEmailSendRateLimit: 'over_email_send_rate_limit',
  weakPassword: 'weak_password',
} as const

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

export const createAuthClient = ({ config }: { config: ReadyAuthConfig }): AuthClient =>
  createBrowserClient(config.supabaseUrl, config.publishableKey, {
    cookieOptions: { name: config.cookieName, sameSite: 'lax', path: '/' },
  }).auth
