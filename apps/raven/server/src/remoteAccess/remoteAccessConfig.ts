import { isIP } from 'node:net'
import { REACHABILITY_CHECK_PATH } from '@raven/core'
import { AUTH_ENV, originOf } from '@/auth/authConfig'

export const REMOTE_ACCESS_ENV = {
  proxySecret: 'RAVEN_PROXY_SECRET',
  trustedProxies: 'RAVEN_TRUSTED_PROXIES',
} as const

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
  /**
   * The proxies whose `X-Forwarded-For` raven believes (`RAVEN_TRUSTED_PROXIES`),
   * each an address or a CIDR range: DSM's reverse proxy as raven's socket
   * sees it. Fastify's `trustProxy` walks the header from the right past
   * them to the client. Empty, raven believes no header, and a private
   * socket that forwards one is taken for the internet.
   */
  trustedProxies: readonly string[]
}

/** The widest prefix each IP version takes, by `isIP`'s answer. */
const PREFIX_BITS: Readonly<Record<number, number>> = { 4: 32, 6: 128 }

/** Whether an entry is an address, or an address and a prefix length it can take. */
const isProxyEntry = (entry: string): boolean => {
  const [address = '', prefix, ...rest] = entry.split('/')
  const maxBits = PREFIX_BITS[isIP(address)] ?? null
  if (maxBits === null || rest.length > 0) return false
  if (prefix === undefined) return true
  const bits = Number(prefix)
  return /^\d+$/u.test(prefix) && bits <= maxBits
}

/** The trusted proxies, read once at boot; a malformed entry stops the server rather than trust too much or too little. */
const readTrustedProxies = (raw: string): readonly string[] => {
  const entries = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
  const malformed = entries.filter((entry) => !isProxyEntry(entry))
  if (malformed.length > 0) {
    throw new Error(
      `${REMOTE_ACCESS_ENV.trustedProxies} takes addresses and CIDR ranges, not: ${malformed.join(', ')}`,
    )
  }
  return entries
}

export const readRemoteAccessConfig = (env: NodeJS.ProcessEnv): RemoteAccessConfig => {
  const site = originOf(env[AUTH_ENV.webUrl]?.trim() ?? '')
  const secret = env[REMOTE_ACCESS_ENV.proxySecret]?.trim() ?? ''
  return {
    checkUrl: site === null ? null : `${site}${REACHABILITY_CHECK_PATH}`,
    proxySecret: secret.length < MIN_PROXY_SECRET_LENGTH ? null : new TextEncoder().encode(secret),
    trustedProxies: readTrustedProxies(env[REMOTE_ACCESS_ENV.trustedProxies] ?? ''),
  }
}
