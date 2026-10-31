import { PLAYER_SOURCE_KINDS } from '@raven/core'
import type { DownloadService } from '@/main/downloads/downloadService'
import type { ResolvedSource } from '@/main/player/loadTarget'
import type { createServerSources } from '@/main/servers/serverSources'

type CreateMusicResolveProps = {
  /** The music relay's sources, which mint the track's first ticket. */
  sources: Pick<ReturnType<typeof createServerSources>, 'resolve'>
  downloads: Pick<DownloadService, 'trackPathOf'>
  /** The one server, read at each call. */
  serverId: () => string
}

/**
 * What the music engine plays for a track: its ready download, which needs no server and so
 * no ticket, as a ready download of a video does; else the server's track through the relay.
 */
export const createMusicResolve =
  ({ sources, downloads, serverId }: CreateMusicResolveProps) =>
  async (mediaId: number): Promise<ResolvedSource> => {
    const server = serverId()
    const path = await downloads.trackPathOf({ serverId: server, mediaId })
    if (path !== null) {
      return { ok: true, target: { kind: PLAYER_SOURCE_KINDS.file, path, sidecars: [] } }
    }
    return sources.resolve({ kind: PLAYER_SOURCE_KINDS.server, serverId: server, mediaId })
  }
