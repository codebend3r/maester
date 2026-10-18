import type { QueryClient } from '@tanstack/react-query'
import { clearAccountState } from '@/lib/clearAccountState'
import { useAuthSession } from '@/stores/authSession'

const SIGN_OUT_SCOPES = { local: 'local' } as const

/**
 * Ends the session and empties what it left behind. When Supabase cannot be
 * reached its sign out keeps the session, so the local one is ended instead:
 * the cookie goes either way.
 */
export const signOut = async ({ queryClient }: { queryClient: QueryClient }): Promise<void> => {
  const client = useAuthSession.getState().client
  if (client !== null) {
    const { error } = await client.signOut()
    if (error) await client.signOut({ scope: SIGN_OUT_SCOPES.local })
  }
  clearAccountState({ queryClient })
}
