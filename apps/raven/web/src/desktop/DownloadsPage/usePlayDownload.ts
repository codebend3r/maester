import { DESKTOP_REQUESTS } from '@raven/core'
import { useOpenReply } from '@/desktop/openReply'
import { useDownloadsHost } from '@/stores/downloadsHost'
import { askMain } from '@/desktop/client'

/** Opens a ready download in the player: the host says where it plays and the page goes to it. */
export const usePlayDownload = (): ((downloadId: string) => Promise<void>) => {
  const host = useDownloadsHost()
  const openReply = useOpenReply()
  return async (downloadId) =>
    openReply(
      await askMain({ client: host, request: { type: DESKTOP_REQUESTS.openDownload, downloadId } }),
    )
}
