import { AUTH_CONFIG_STATES, AUTH_COOKIE, type AuthConfig, type SignInConfig } from '@raven/core'

/** The sign-in a server with accounts names first, which the app pins. */
export const PIN = {
  supabaseUrl: 'https://project.supabase.co',
  publishableKey: 'sb_publishable_example',
  webUrl: 'https://raven.example.test',
} as const satisfies SignInConfig

/** The same server's sign-in once it has moved to another Supabase project. */
export const MOVED_PIN = {
  supabaseUrl: 'https://moved.supabase.co',
  publishableKey: 'sb_publishable_moved',
  webUrl: 'https://raven.example.test',
} as const satisfies SignInConfig

/** What `GET /api/auth/config` answers for a server whose accounts are ready at `pin`. */
export const readyConfigOf = (pin: SignInConfig): AuthConfig => ({
  state: AUTH_CONFIG_STATES.ready,
  ...pin,
  cookieName: AUTH_COOKIE,
})
