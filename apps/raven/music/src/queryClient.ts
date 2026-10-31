import { createQueryClient, useAudioQueue } from '@raven/ui/headless'

import { useDownloads } from '@/downloads/downloadStore'
import { useWrenAccount } from '@/session'

/** Wren's one cache: it talks to one server. */
export const queryClient = createQueryClient()

const IGNORED = (): void => undefined

/**
 * Empties the cache and the queue whenever the signed-in account changes, signing out
 * included, so the next account never sees what the last one read (its playlists, its
 * favourites) and the last one's music stops rather than counting its listens and saving its
 * book's spot under the next one's token. The downloads are their owner's: another account
 * signing in removes them, files and all, since they hold its playlists and the tracks its PIN
 * unlocked; a sign-out, a refresh the server refused and the same account signing back in keep
 * them, out of reach behind sign-in meanwhile. A renewed token is the same account and keeps all
 * of it. Hands back the way to stop.
 */
export const forgetOnAccountChange = (): (() => void) =>
  useWrenAccount.subscribe((state, before) => {
    const accountId = state.session?.userId ?? null
    if (accountId === (before.session?.userId ?? null)) return
    queryClient.clear()
    useAudioQueue.getState().clear()
    useDownloads.getState().keepFor({ accountId }).catch(IGNORED)
  })
