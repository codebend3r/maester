import { useAudioQueue } from '@raven/ui/headless'
import type { QueryClient } from '@tanstack/react-query'

type ClearAccountStateProps = { queryClient: QueryClient }

/**
 * Everything one account left in this tab that the next one must not see or hear: its answers,
 * and its queue, so its music stops rather than counting listens under the next one's session.
 * Queries are reset rather than removed, since removing one detaches whoever is watching it until
 * their next render.
 */
export const clearAccountState = async ({ queryClient }: ClearAccountStateProps): Promise<void> => {
  useAudioQueue.getState().clear()
  await queryClient.resetQueries()
}
