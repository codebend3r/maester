import type { TrackPlan } from '@raven/native/headless'

import { useDownloads } from '@/downloads/downloadStore'
import { downloadedOf } from '@/downloads/downloadViews'
import { useWrenPrefs } from '@/stores/wrenPrefs'

type TrackPlanForProps = {
  serverId: string
  /** Whether the device is on a mobile network now. */
  isOnCellular: () => Promise<boolean>
  /** The `file://` address a download's path is at now. */
  uriOf: (path: string) => string
}

/**
 * What Wren plays a track from before the server's file: its download from this server, with
 * the cover saved beside it, then on a mobile network the transcode at "Cellular quality". A
 * network that cannot be read is taken for Wi-Fi.
 */
export const trackPlanFor = ({ serverId, isOnCellular, uriOf }: TrackPlanForProps): TrackPlan => ({
  downloadedOf: (track) => {
    const entry = downloadedOf({
      entries: useDownloads.getState().entries,
      serverId,
      mediaId: track.id,
    })
    if (entry === undefined) return null
    return {
      uri: uriOf(entry.path),
      artworkUri: entry.coverPath === null ? null : uriOf(entry.coverPath),
    }
  },
  streamKbps: async () => {
    const isCellular = await isOnCellular().catch(() => false)
    return isCellular ? useWrenPrefs.getState().cellularKbps : null
  },
})
