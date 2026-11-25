import type { SupabaseClient } from '@supabase/supabase-js'
import type { ReadyAuthConfig } from '@raven/core'

/** What Wren asks of Supabase Auth: sign in with a password, follow the session, renew it, end it. */
export type AuthClient = Pick<
  SupabaseClient['auth'],
  'signInWithPassword' | 'signOut' | 'refreshSession' | 'getSession' | 'onAuthStateChange'
>

type CreateAuthClientProps = { config: ReadyAuthConfig }

/**
 * Builds the client the server's config names, loading Supabase's code only now. It keeps the
 * session in the browser's cookie, under the name raven's server reads, so an `<audio>` and an
 * `<img>` on the page's own origin are opened by it with no header of their own.
 */
export const createAuthClient = async ({ config }: CreateAuthClientProps): Promise<AuthClient> => {
  const { createBrowserClient } = await import('@supabase/ssr')
  return createBrowserClient(config.supabaseUrl, config.publishableKey, {
    cookieOptions: { name: config.cookieName, sameSite: 'lax', path: '/' },
  }).auth
}
