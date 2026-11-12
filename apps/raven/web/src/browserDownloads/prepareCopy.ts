import { DEVICE_DOWNLOAD_STATES } from '@raven/core'
import type { DownloadClock } from '@/browserDownloads/clock'
import { BROWSER_DOWNLOAD_COPY } from '@/browserDownloads/copy'
import type { BrowserEntry } from '@/browserDownloads/entries'
import { ABORTED, OUTCOMES, type Outcome } from '@/browserDownloads/outcomes'
import type { DownloadServer } from '@/browserDownloads/server'
import { VARIANT_OF } from '@/browserDownloads/ways'

/** How often the server is asked how far along its copy is. */
export const PREPARE_POLL_MS = 2000

type PrepareCopyProps = {
  server: DownloadServer
  clock: DownloadClock
  entry: Pick<BrowserEntry, 'mediaId' | 'way'>
  signal: AbortSignal
  /** Hears how far along the copy is, from 0 to 1, and null once the wait is over. */
  onProgress: (progress: number | null) => void
  /** Hears the copy's size once it is ready; until then the entry held the original's. */
  onSize: (size: number) => void
}

/**
 * Asks the server to make the copy a download is of, and waits for it. Answers null once there
 * is a file to fetch (the original needs no copy), else how the download ends.
 */
export const prepareCopy = async (props: PrepareCopyProps): Promise<Outcome | null> => {
  const { server, clock, entry, signal, onProgress, onSize } = props
  if (signal.aborted) return ABORTED
  const variant = VARIANT_OF[entry.way]
  if (variant === null) return null
  const answer = await server.api.getDeviceDownload({ mediaId: entry.mediaId, variant })
  if (signal.aborted) return ABORTED
  switch (answer.state) {
    case DEVICE_DOWNLOAD_STATES.ready:
      onSize(answer.bytes)
      onProgress(null)
      return null
    case DEVICE_DOWNLOAD_STATES.failed:
      onProgress(null)
      return {
        kind: OUTCOMES.failed,
        message: answer.message === '' ? BROWSER_DOWNLOAD_COPY.noCopy : answer.message,
      }
    case DEVICE_DOWNLOAD_STATES.preparing:
      onProgress(answer.progress)
      await clock.sleep({ ms: PREPARE_POLL_MS, signal })
      return prepareCopy(props)
    default: {
      const unreachable: never = answer
      return unreachable
    }
  }
}
