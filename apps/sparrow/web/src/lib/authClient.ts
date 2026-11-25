import type { SupabaseClient } from '@supabase/supabase-js'
import type { ReadyAuthConfig } from '@/lib/api'

/** What sparrow asks of Supabase Auth: sign in with a password, follow the session, end it. */
export type AuthClient = Pick<
  SupabaseClient['auth'],
  'signInWithPassword' | 'signOut' | 'getSession' | 'onAuthStateChange'
>

type CreateAuthClientProps = { config: ReadyAuthConfig }

/**
 * Builds the client raven's config names, loading Supabase's code only now. It keeps the session
 * in the browser's storage and renews the access token before it expires, announcing each new one.
 */
export const createAuthClient = async ({ config }: CreateAuthClientProps): Promise<AuthClient> => {
  const { createClient } = await import('@supabase/supabase-js')
  return createClient(config.supabaseUrl, config.publishableKey).auth
}
