import { audioPlayer } from '@raven/audio'
import { IGNORED, forgetOnAccountChange } from '@raven/native/headless'
import { createQueryClient } from '@raven/ui/headless'

import { useDownloads } from '@/downloads/downloadStore'
import { useWrenAccount } from '@/session'

/** Wren's one cache: it talks to one server. */
export const queryClient = createQueryClient()

type KeepDownloadsForProps = { accountId: string | null }

/**
 * Keeps the downloads for `accountId`, or removes them when it is not their owner, and then
 * also forgets the lists native keeps for CarPlay and Android Auto, which hold their owner's
 * titles.
 */
export const keepDownloadsFor = async ({ accountId }: KeepDownloadsForProps): Promise<void> => {
  const isRemoved = await useDownloads.getState().keepFor({ accountId })
  if (isRemoved) await audioPlayer.clearBrowseCache()
}

/**
 * Forgets the last account's answers and queue on every change of account, so its music stops
 * rather than counting its listens and saving its book's spot under the next one's token. The
 * downloads are their owner's: another account signing in removes them, files and all, since
 * they hold its playlists and the tracks its PIN unlocked; a sign-out, a refresh the server
 * refused and the same account signing back in keep them, out of reach behind sign-in
 * meanwhile. Hands back the way to stop.
 */
export const forgetWrenAccount = (): (() => void) =>
  forgetOnAccountChange({
    session: useWrenAccount,
    cache: queryClient,
    alsoForget: ({ accountId }) => {
      keepDownloadsFor({ accountId }).catch(IGNORED)
    },
  })
