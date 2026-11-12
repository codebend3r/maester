import { DOWNLOAD_ROW_COPY } from '@/desktop/DownloadsPage/copy'
import { useDownloadPreparing } from '@/stores/downloadPreparing'

const PERCENT = 100

type WaitingTextProps = { downloadId: string }

/**
 * What a queued download says: that it waits its turn, or how far along the server is with the
 * copy it waits on, which a browser needs of a video it cannot play as it is.
 */
export const WaitingText = ({ downloadId }: WaitingTextProps) => {
  const progress = useDownloadPreparing((state) => state.progress[downloadId])
  return (
    <span>
      {progress === undefined
        ? DOWNLOAD_ROW_COPY.waiting
        : DOWNLOAD_ROW_COPY.preparing(Math.floor(progress * PERCENT))}
    </span>
  )
}
