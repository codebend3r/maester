import type { QueryClient } from '@tanstack/react-query'
import { listingStore } from '@/lib/listingStore'
import { stopKeepingSaved } from '@/lib/keepSaved'
import { useSelectionScopes } from '@/stores/selectionScope'

type ClearAccountStateProps = {
  queryClient: QueryClient
}

/**
 * Everything one account left in this tab that the next one must not see.
 * Queries are reset rather than removed: removing one detaches whoever is
 * watching it until their next render, and a page that clears twice (the
 * session's change, then the sign out) would leave the gate waiting on a
 * query nothing fetches. A mutation under way, the sign out among them, keeps
 * its state for the button that started it. The listings and home kept on
 * this device go too.
 */
export const clearAccountState = async ({ queryClient }: ClearAccountStateProps): Promise<void> => {
  useSelectionScopes.getState().scopes.forEach((scope) => scope.store.getState().end())
  stopKeepingSaved()
  await queryClient.resetQueries()
  await listingStore.clear()
}
