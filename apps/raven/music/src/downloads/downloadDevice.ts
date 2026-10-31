import { apiFor } from '@raven/native'

import type { configureDownloads } from '@/downloads/downloadStore'
import { coverHeadersOf } from '@/music/coverHeaders'
import { mediaSourcesFor } from '@/music/mediaSources'
import { useWrenAccount } from '@/session'
import { useActiveServer } from '@/stores/activeServer'

type DownloadDevice = Omit<Parameters<typeof configureDownloads>[0], 'storage' | 'disk'>

const serverOf = (serverId: string) =>
  useActiveServer.getState().servers.find(({ id }) => id === serverId)

/**
 * Where downloads come from: a track through the server's media access, its album cover with
 * the server's cookies and the account's token, as `useCovers` asks for it, while Wren holds
 * that server; and the account signed in, which owns them.
 */
export const downloadSources: DownloadDevice = {
  accountId: () => useWrenAccount.getState().session?.userId ?? null,
  sourcesOf: (serverId) => {
    const server = serverOf(serverId)
    return server === undefined ? null : mediaSourcesFor(server)
  },
  coverOf: async ({ serverId, track }) => {
    const server = serverOf(serverId)
    if (server === undefined) return null
    const uri = apiFor({ server, session: useWrenAccount }).albumCoverUrl({
      albumId: track.albumId,
      coverVersion: track.album.coverVersion,
    })
    if (uri === null) return null
    return { uri, headers: await coverHeadersOf({ server, uri }) }
  },
}
