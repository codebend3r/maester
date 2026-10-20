import {
  AUTH_CONFIG_STATES,
  type AuthConfig,
  type Infer,
  isString,
  object,
  URL_PROTOCOLS,
} from '@raven/core'

const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]'] as const
const PUBLISHABLE_KEY = /^sb_publishable_[A-Za-z0-9_-]+$/u
const ROOT_PATH = '/'

/**
 * The endpoints a server's sign-in uses, pinned in its entry when raven player first trusts them.
 * The guard checks only their shape; `usableSignIn` is the rule for what they may hold.
 */
export const isSignInConfig = object({
  supabaseUrl: isString,
  publishableKey: isString,
  webUrl: isString,
})

export type SignInConfig = Infer<typeof isSignInConfig>

/**
 * An `https` origin, or `http` on loopback, with no credentials, path, query or hash: the
 * server's own rule for its auth settings, checked again on this side of the trust boundary.
 */
export const signInOriginOf = (value: string): string | null => {
  const url = URL.parse(value)
  if (url === null) return null
  const isLoopback = LOOPBACK_HOSTS.some((host) => url.hostname === host)
  const isAllowedProtocol =
    url.protocol === URL_PROTOCOLS.https || (isLoopback && url.protocol === URL_PROTOCOLS.http)
  if (!isAllowedProtocol) return null
  const isBare =
    url.username === '' &&
    url.password === '' &&
    url.pathname === ROOT_PATH &&
    url.search === '' &&
    url.hash === ''
  return isBare ? url.origin : null
}

/**
 * The endpoints rebuilt from their three fields, when every one of them is one raven player can
 * use: the rule for a server's config and for a pin read back from disk alike.
 */
export const usableSignIn = ({
  supabaseUrl,
  publishableKey,
  webUrl,
}: SignInConfig): SignInConfig | null => {
  const supabaseOrigin = signInOriginOf(supabaseUrl)
  const webOrigin = signInOriginOf(webUrl)
  if (supabaseOrigin === null || webOrigin === null) return null
  if (!PUBLISHABLE_KEY.test(publishableKey)) return null
  return { supabaseUrl: supabaseOrigin, publishableKey, webUrl: webOrigin }
}

/** A ready config's endpoints, when every one of them is one raven player can use. */
export const signInConfigOf = (config: AuthConfig): SignInConfig | null =>
  config.state === AUTH_CONFIG_STATES.ready ? usableSignIn(config) : null

/** Whether two pins name the same endpoints. */
export const isSameSignIn = ({ a, b }: { a: SignInConfig; b: SignInConfig }): boolean =>
  a.supabaseUrl === b.supabaseUrl && a.publishableKey === b.publishableKey && a.webUrl === b.webUrl

/** The host a sign-in goes to, which the page and main's sheet show; never the address behind it. */
export const signInHostOf = ({ supabaseUrl }: Pick<SignInConfig, 'supabaseUrl'>): string | null =>
  URL.parse(supabaseUrl)?.host ?? null
