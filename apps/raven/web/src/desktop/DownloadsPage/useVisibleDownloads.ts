import type { DownloadView } from '@raven/core'
import { useQuery } from '@tanstack/react-query'
import { useDownloads } from '@/desktop/downloadsApi'
import { hasPrivateDownloads, visibleDownloadsOf } from '@/desktop/DownloadsPage/libraries'
import { lockQuery } from '@/lib/queries'

/** The host's downloads, and those of them the viewer may see now. */
export type VisibleDownloads = {
  /** Every download the host keeps; null until the list is read. */
  held: DownloadView[] | null
  /** The ones the viewer may see, a private library's left out until the PIN is entered; null until read. */
  visible: DownloadView[] | null
  error: Error | null
}

/**
 * The downloads a page shows. Whether the PIN has been entered is the server's answer alone:
 * while it is on its way, or out of reach with no earlier answer, a private library's downloads
 * stay hidden, and an answer it gave before it went out of reach stands. The lock is asked about
 * only when a download is private, and nothing here opens the PIN pad.
 */
export const useVisibleDownloads = (): VisibleDownloads => {
  const downloads = useDownloads()
  const held = downloads.data?.downloads ?? null
  const lock = useQuery({ ...lockQuery, enabled: hasPrivateDownloads(held ?? []) })
  const isUnlocked = !!lock.data?.unlocked
  return {
    held,
    visible: held === null ? null : visibleDownloadsOf({ downloads: held, isUnlocked }),
    error: downloads.error,
  }
}
