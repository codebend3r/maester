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
 * book's spot under the next one's token. An account signing out or giving way to another also
 * takes its downloads with it, files and all, since they hold its playlists and the tracks its
 * PIN unlocked; the read of the stored account as Wren opens is no change of hands. A renewed
 * token is the same account and keeps all of it. Hands back the way to stop.
 */
export const forgetOnAccountChange = (): (() => void) =>
  useWrenAccount.subscribe((state, before) => {
    const was = before.session?.userId ?? null
    if ((state.session?.userId ?? null) === was) return
    queryClient.clear()
    useAudioQueue.getState().clear()
    if (was !== null) useDownloads.getState().removeAll().catch(IGNORED)
  })
