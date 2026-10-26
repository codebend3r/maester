import type { QueryClient } from '@tanstack/react-query'
import { listingStore } from '@/lib/listingStore'
import { stopKeepingListings } from '@/lib/savedListings'
import { useSelectionScopes } from '@/stores/selectionScope'
import { useUnlockPrompt } from '@raven/ui/headless'

type ClearAccountStateProps = {
  queryClient: QueryClient
}

/**
 * Everything one account left in this tab that the next one must not see.
 * Queries are reset rather than removed: removing one detaches whoever is
 * watching it until their next render, and a page that clears twice (the
 * session's change, then the sign out) would leave the gate waiting on a
 * query nothing fetches. A mutation under way, the sign out among them, keeps
 * its state for the button that started it. The listings kept on this device
 * go too.
 */
export const clearAccountState = async ({ queryClient }: ClearAccountStateProps): Promise<void> => {
  useUnlockPrompt.getState().close()
  useSelectionScopes.getState().scopes.forEach((scope) => scope.store.getState().end())
  stopKeepingListings()
  await queryClient.resetQueries()
  await listingStore.clear()
}
