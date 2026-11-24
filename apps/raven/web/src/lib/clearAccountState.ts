import type { QueryClient } from '@tanstack/react-query'
import { useActiveServer } from '@raven/ui/headless'
import { listingStore } from '@/lib/listingStore'
import { stopKeepingSaved } from '@/lib/keepSaved'
import { useSelectionScopes } from '@/stores/selectionScope'

type ClearAccountStateProps = {
  queryClient: QueryClient
}

/**
 * What one server left in this tab outside the query cache, which a switch of server empties:
 * a selection under way and the device's saves waiting to be written, which would keep that
 * server's listings under the next one's name.
 */
export const clearServerState = (): void => {
  useSelectionScopes.getState().scopes.forEach((scope) => scope.store.getState().end())
  stopKeepingSaved()
}

/**
 * Everything one account left in this tab that the next one must not see.
 * Queries are reset rather than removed: removing one detaches whoever is
 * watching it until their next render, and a page that clears twice (the
 * session's change, then the sign out) would leave the gate waiting on a
 * query nothing fetches. A mutation under way, the sign out among them, keeps
 * its state for the button that started it. The listings and home kept on
 * this device go too, and the page goes back to its home server, since the
 * others are the account's.
 */
export const clearAccountState = async ({ queryClient }: ClearAccountStateProps): Promise<void> => {
  clearServerState()
  useActiveServer.getState().choose(null)
  await queryClient.resetQueries()
  await listingStore.clear()
}
