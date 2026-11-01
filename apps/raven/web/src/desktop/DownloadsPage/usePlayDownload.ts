import { DESKTOP_REQUESTS } from '@raven/core'
import { useOpenReply } from '@/desktop/openReply'
import { useDesktop } from '@/stores/desktop'

/** Opens a ready download in the player: main grants its file and the page goes to it. */
export const usePlayDownload = (): ((downloadId: string) => Promise<void>) => {
  const { client } = useDesktop()
  const openReply = useOpenReply()
  return async (downloadId) =>
    openReply(await client.request({ type: DESKTOP_REQUESTS.openDownload, downloadId }))
}
