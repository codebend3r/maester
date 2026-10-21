import { AUTH_CONFIG_STATES, type AuthConfig } from '@/contract'
import { type Infer, isString, object } from '@/schema'
import { serverNameFor } from '@/serverList'
import { serverOriginOf } from '@/serverOrigin'
import { URL_PROTOCOLS } from '@/urls'

const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]'] as const
const PUBLISHABLE_KEY = /^sb_publishable_[A-Za-z0-9_-]+$/u
const PORT = /:\d+$/u

/**
 * The endpoints a server's sign-in uses, which a client pins with the server the first time it
 * trusts them. The guard checks only their shape; `usableSignIn` is the rule for what they may
 * hold.
 */
export const isSignInConfig = object({
  supabaseUrl: isString,
  publishableKey: isString,
  webUrl: isString,
})

export type SignInConfig = Infer<typeof isSignInConfig>

/**
 * An `https` origin, or `http` on loopback, with no credentials, path, query or hash: the
 * server's own rule for its auth settings, checked again on the client's side of the trust
 * boundary. Read with `serverOriginOf`, so it needs no `URL`.
 */
export const signInOriginOf = (value: string): string | null => {
  const origin = serverOriginOf(value)
  if (origin === null) return null
  if (origin.startsWith(`${URL_PROTOCOLS.https}//`)) return origin
  const host = serverNameFor(origin).replace(PORT, '')
  return LOOPBACK_HOSTS.some((loopback) => loopback === host) ? origin : null
}

/**
 * The endpoints rebuilt from their three fields, when every one of them is one a client can
 * use: the rule for a server's config and for a pin read back from storage alike.
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

/** A ready config's endpoints, when every one of them is one a client can use. */
export const signInConfigOf = (config: AuthConfig): SignInConfig | null =>
  config.state === AUTH_CONFIG_STATES.ready ? usableSignIn(config) : null

/** Whether two pins name the same endpoints. */
export const isSameSignIn = ({ a, b }: { a: SignInConfig; b: SignInConfig }): boolean =>
  a.supabaseUrl === b.supabaseUrl && a.publishableKey === b.publishableKey && a.webUrl === b.webUrl

/** The host, with its port, a sign-in's password goes to, which a client shows when it asks; never the address behind it. */
export const signInHostOf = ({ supabaseUrl }: Pick<SignInConfig, 'supabaseUrl'>): string | null => {
  const origin = signInOriginOf(supabaseUrl)
  return origin === null ? null : serverNameFor(origin)
}
