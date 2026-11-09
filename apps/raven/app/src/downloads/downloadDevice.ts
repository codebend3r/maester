import { accessTokenNow, apiFor, cookieJar } from '@raven/native'
import { cookieHeadersFor } from '@raven/native/headless'

import { useAccountSession } from '@/account/session'
import { GROUP_KINDS, type DownloadGroup } from '@/downloads/downloadEntries'
import { deviceDisk } from '@/downloads/downloadDisk'
import { logoOf } from '@/downloads/downloadRequests'
import type { DownloadDevice, DownloadServer } from '@/downloads/downloadRun'
import { mediaSourcesFor } from '@/player/mediaSources'
import { useActiveServer } from '@/stores/activeServer'

/** The groups whose id is an item with title art: a movie and a show. */
const TITLE_ART_GROUPS: ReadonlySet<DownloadGroup['kind']> = new Set([
  GROUP_KINDS.movie,
  GROUP_KINDS.show,
])

/**
 * Where downloads come from on the device: a server this device holds, through the player's own
 * media access (the origin it picks, a ticket per download, whose file pass keeps a started one
 * going for 12 hours), its API for the server's MP4 copy and a file's tracks, and a picture with
 * the cookies and token its own API takes.
 */
const serverOf = (serverId: string): DownloadServer | null => {
  const server = useActiveServer.getState().servers.find(({ id }) => id === serverId)
  if (server === undefined) return null
  const api = apiFor({ server, session: useAccountSession })
  return {
    sources: mediaSourcesFor(server),
    prepare: (mediaId) => api.getDeviceDownload(mediaId),
    tracks: (mediaId) => api.getTracks(mediaId),
    titleArtOf: async (group) =>
      TITLE_ART_GROUPS.has(group.kind)
        ? logoOf({ api, details: await api.getItem(group.id) })
        : null,
    pictureHeaders: async (uri) =>
      cookieHeadersFor({
        server,
        cookies: await cookieJar.read(server.id),
        accessToken: accessTokenNow({ session: useAccountSession }),
      })(uri),
  }
}

/** The device's disk and servers, for `configureDownloads`. */
export const DOWNLOAD_DEVICE: DownloadDevice = {
  disk: deviceDisk,
  serverOf,
  now: Date.now,
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}
