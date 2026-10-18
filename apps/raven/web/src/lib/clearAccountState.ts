import type { QueryClient } from '@tanstack/react-query'
import { useSelectionScopes } from '@/stores/selectionScope'
import { useUnlockPrompt } from '@/stores/unlockPrompt'

/** Everything one account left in this tab that the next one must not see. */
export const clearAccountState = ({ queryClient }: { queryClient: QueryClient }): void => {
  queryClient.clear()
  useUnlockPrompt.getState().close()
  useSelectionScopes.getState().scopes.forEach((scope) => scope.store.getState().end())
}
