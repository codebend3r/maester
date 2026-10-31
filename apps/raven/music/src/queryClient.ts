import { createQueryClient, useAudioQueue } from '@raven/ui/headless'

import { useWrenAccount } from '@/session'

/** Wren's one cache: it talks to one server. */
export const queryClient = createQueryClient()

/**
 * Empties the cache and the queue whenever the signed-in account changes, signing out
 * included, so the next account never sees what the last one read (its playlists, its
 * favourites) and the last one's music stops rather than counting its listens and saving its
 * book's spot under the next one's token. A renewed token is the same account and keeps both.
 * Hands back the way to stop.
 */
export const forgetOnAccountChange = (): (() => void) =>
  useWrenAccount.subscribe((state, before) => {
    if ((state.session?.userId ?? null) === (before.session?.userId ?? null)) return
    queryClient.clear()
    useAudioQueue.getState().clear()
  })
