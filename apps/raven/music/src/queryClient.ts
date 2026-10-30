import { createQueryClient } from '@raven/ui/headless'

import { useWrenAccount } from '@/session'

/** Wren's one cache: it talks to one server. */
export const queryClient = createQueryClient()

/**
 * Empties the cache whenever the signed-in account changes, signing out included, so the next
 * account never sees what the last one read: its playlists, its favourites. A renewed token is
 * the same account and keeps it. Hands back the way to stop.
 */
export const forgetOnAccountChange = (): (() => void) =>
  useWrenAccount.subscribe((state, before) => {
    if ((state.session?.userId ?? null) !== (before.session?.userId ?? null)) queryClient.clear()
  })
