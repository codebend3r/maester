import { AUTH_CONFIG_STATES, AUTH_COOKIE, type AuthConfig, usableSignIn } from '@raven/core'

export const AUTH_ENV = {
  url: 'SUPABASE_URL',
  key: 'SUPABASE_PUBLISHABLE_KEY',
  webUrl: 'RAVEN_WEB_URL',
  accounts: 'RAVEN_ACCOUNTS',
} as const

/** The one value of `RAVEN_ACCOUNTS` that reopens a server which once enforced accounts. */
export const ACCOUNTS_OPT_OUT = 'off'

/**
 * The sign-in a server publishes, read from its environment: off when none
 * of it is set, unavailable when any of it is missing or is not what
 * core's `usableSignIn` takes (an `https` origin, or `http` on loopback,
 * and a publishable key), the same rule every client checks it against.
 */
export const readAuthConfig = (env: NodeJS.ProcessEnv): AuthConfig => {
  const url = env[AUTH_ENV.url]?.trim() ?? ''
  const key = env[AUTH_ENV.key]?.trim() ?? ''
  const web = env[AUTH_ENV.webUrl]?.trim() ?? ''
  if (url === '' && key === '' && web === '') return { state: AUTH_CONFIG_STATES.off }
  const usable = usableSignIn({ supabaseUrl: url, publishableKey: key, webUrl: web })
  if (usable === null) return { state: AUTH_CONFIG_STATES.unavailable }
  return { state: AUTH_CONFIG_STATES.ready, ...usable, cookieName: AUTH_COOKIE }
}
