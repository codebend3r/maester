import { AUTH_CONFIG_STATES, AUTH_COOKIE, type AuthConfig, URL_PROTOCOLS } from '@raven/core'

export const AUTH_ENV = {
  url: 'SUPABASE_URL',
  key: 'SUPABASE_PUBLISHABLE_KEY',
  webUrl: 'RAVEN_WEB_URL',
  accounts: 'RAVEN_ACCOUNTS',
} as const

/** The one value of `RAVEN_ACCOUNTS` that reopens a server which once enforced accounts. */
export const ACCOUNTS_OPT_OUT = 'off'

const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]'] as const

const originOf = (value: string): string | null => {
  try {
    const url = new URL(value)
    const isLocal = LOOPBACK_HOSTS.some((host) => url.hostname === host)
    if (url.protocol !== URL_PROTOCOLS.https && !(isLocal && url.protocol === URL_PROTOCOLS.http)) {
      return null
    }
    return url.username === '' &&
      url.password === '' &&
      url.pathname === '/' &&
      url.search === '' &&
      url.hash === ''
      ? url.origin
      : null
  } catch {
    return null
  }
}

export const readAuthConfig = (env: NodeJS.ProcessEnv): AuthConfig => {
  const url = env[AUTH_ENV.url]?.trim() ?? ''
  const key = env[AUTH_ENV.key]?.trim() ?? ''
  const web = env[AUTH_ENV.webUrl]?.trim() ?? ''
  if (url === '' && key === '' && web === '') return { state: AUTH_CONFIG_STATES.off }
  const supabaseUrl = originOf(url)
  const webUrl = originOf(web)
  if (supabaseUrl === null || webUrl === null || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) {
    return { state: AUTH_CONFIG_STATES.unavailable }
  }
  return {
    state: AUTH_CONFIG_STATES.ready,
    supabaseUrl,
    publishableKey: key,
    webUrl,
    cookieName: AUTH_COOKIE,
  }
}
