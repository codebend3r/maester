import { useDownloads } from '@/downloads/downloadStore'
import { downloadsSummaryOf } from '@/screens/library/downloadRows'

/** What is downloaded from the active server: its albums, playlists and bytes. */
export const useDownloadsSummary = (serverId: string) => {
  const entries = useDownloads((state) => state.entries)
  const playlists = useDownloads((state) => state.playlists)
  return downloadsSummaryOf({ entries, playlists, serverId })
}
