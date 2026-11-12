import type { DownloadView } from '@raven/core'
import { useQuery } from '@tanstack/react-query'
import { hasPrivateDownloads } from '@/desktop/DownloadsPage/libraries'
import { lockQuery } from '@/lib/queries'

/**
 * Whether the PIN has been entered, which shows a private library's downloads. Only the server's
 * answer counts: while it is on its way, or out of reach with no earlier answer, they stay
 * hidden, and an answer it gave before it went out of reach stands. The lock is asked about only
 * when a download is private, and nothing here opens the PIN pad.
 */
export const useDownloadsUnlocked = (downloads: readonly DownloadView[]): boolean => {
  const lock = useQuery({ ...lockQuery, enabled: hasPrivateDownloads(downloads) })
  return !!lock.data?.unlocked
}
