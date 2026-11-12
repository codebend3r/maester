import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { downloadsAccountOf } from '@/browserDownloads/account'
import type { BrowserDownloads } from '@/browserDownloads/engine'
import { DownloadDialog } from '@/desktop/DownloadDialog/DownloadDialog'
import { applyDownloadsEvent } from '@/desktop/downloadsApi'
import { useFollowServerReach, useReturnWhenReached } from '@/desktop/serverReach'
import { authConfigQuery } from '@/lib/queries'
import { useAuthSession } from '@/stores/authSession'
import { useBrowserDownloads } from '@/stores/browserDownloads'
import { useDownloadAsk } from '@/stores/downloadAsk'
import { useDownloadPreparing } from '@/stores/downloadPreparing'
import { useServerReach } from '@/stores/serverReach'

/** Tells the engine whose downloads to show and run, and remembers who signed in for when no server says. */
const useDownloadsAccount = (engine: BrowserDownloads): void => {
  const authState = useQuery(authConfigQuery).data?.state ?? null
  const userId = useAuthSession((state) => state.session?.userId ?? null)
  const isOffline = useServerReach((state) => state.isOffline)
  const remembered = useBrowserDownloads((state) => state.lastAccountId)
  const remember = useBrowserDownloads((state) => state.remember)
  const accountId = downloadsAccountOf({ authState, userId, isOffline, remembered })

  useEffect(() => {
    if (userId !== null) remember(userId)
  }, [userId, remember])

  useEffect(() => {
    engine.setAccount(accountId)
  }, [engine, accountId])
}

type BrowserDownloadsHostProps = { engine: BrowserDownloads }

/**
 * The browser's downloads' part of the page, mounted once over every route, as `DesktopHost` is
 * Raven's: it hands the engine the page's account, hears its changes into the Downloads page's
 * cache, follows whether the server can be reached (queueing again what a lost connection
 * stopped once it answers), and shows the download dialog.
 */
export const BrowserDownloadsHost = ({ engine }: BrowserDownloadsHostProps) => {
  const queryClient = useQueryClient()
  const shownAsk = useDownloadAsk((state) => state.shown)
  const closeAsk = useDownloadAsk((state) => state.close)
  const isOffline = useServerReach((state) => state.isOffline)

  useFollowServerReach({ shouldFollowDevice: true })
  useReturnWhenReached()
  useDownloadsAccount(engine)

  useEffect(
    () =>
      engine.subscribe(({ downloads, preparing }) => {
        useDownloadPreparing.setState({ progress: preparing })
        applyDownloadsEvent({
          queryClient,
          event: { downloads, shouldAutoDeleteByDefault: false },
        }).catch(() => undefined)
      }),
    [engine, queryClient],
  )

  useEffect(() => {
    if (!isOffline) engine.reconnected()
  }, [engine, isOffline])

  return (
    shownAsk !== null && (
      <DownloadDialog key={shownAsk.instance} ask={shownAsk.ask} onClose={closeAsk} />
    )
  )
}
