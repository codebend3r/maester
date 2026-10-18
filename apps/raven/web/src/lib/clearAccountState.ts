import type { QueryClient } from '@tanstack/react-query'
import { useSelectionScopes } from '@/stores/selectionScope'
import { useUnlockPrompt } from '@/stores/unlockPrompt'

/**
 * Everything one account left in this tab that the next one must not see.
 * Queries are reset rather than removed: removing one detaches whoever is
 * watching it until their next render, and a page that clears twice (the
 * session's change, then the sign out) would leave the gate waiting on a
 * query nothing fetches. A mutation under way, the sign out among them, keeps
 * its state for the button that started it.
 */
export const clearAccountState = ({ queryClient }: { queryClient: QueryClient }): void => {
  void queryClient.resetQueries()
  useUnlockPrompt.getState().close()
  useSelectionScopes.getState().scopes.forEach((scope) => scope.store.getState().end())
}
