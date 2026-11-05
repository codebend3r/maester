import { REACHABILITY_CHECK_PATH } from '@raven/core'
import { AUTH_ENV, originOf } from '@/auth/authConfig'

export const REMOTE_ACCESS_ENV = { proxySecret: 'RAVEN_PROXY_SECRET' } as const

/** A shorter secret could be guessed; Netlify signs with whatever the site's variable holds. */
const MIN_PROXY_SECRET_LENGTH = 32

export type RemoteAccessConfig = {
  /**
   * Where raven asks to be checked from outside its network: the web app's
   * site (`RAVEN_WEB_URL`) and its reachability function. Null without one,
   * when the Admin page says raven cannot check.
   */
  checkUrl: string | null
  /**
   * The secret Netlify's signed proxy (`apps/raven/web/netlify.toml`) signs
   * each `/api` request with, the same value as the site's
   * `RAVEN_PROXY_SECRET`, so the rate limits count each Netlify visitor by
   * their own address. Null when unset or too short, and then every visitor
   * of the Netlify site is counted by Netlify's address. Never logged.
   */
  proxySecret: Uint8Array | null
}

export const readRemoteAccessConfig = (env: NodeJS.ProcessEnv): RemoteAccessConfig => {
  const site = originOf(env[AUTH_ENV.webUrl]?.trim() ?? '')
  const secret = env[REMOTE_ACCESS_ENV.proxySecret]?.trim() ?? ''
  return {
    checkUrl: site === null ? null : `${site}${REACHABILITY_CHECK_PATH}`,
    proxySecret: secret.length < MIN_PROXY_SECRET_LENGTH ? null : new TextEncoder().encode(secret),
  }
}
