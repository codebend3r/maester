import { type AudioBitrate, PLAYER_SOURCE_KINDS } from '@raven/core'
import type { DownloadService } from '@/main/downloads/downloadService'
import type { ResolvedSource } from '@/main/player/loadTarget'
import type { createServerSources } from '@/main/servers/serverSources'

type CreateMusicResolveProps = {
  /** The music relay's sources, which mint the track's first ticket. */
  sources: Pick<ReturnType<typeof createServerSources>, 'resolveTrack'>
  downloads: Pick<DownloadService, 'trackPathOf'>
  /** The one server, read at each call. */
  serverId: () => string
}

export type MusicResolveProps = {
  mediaId: number
  /** The transcode's bitrate for a server track; null for its file. */
  kbps: AudioBitrate | null
}

/**
 * What the music engine plays for a track: its ready download, which needs no server and so
 * no ticket, as a ready download of a video does, whatever bitrate is asked; else the server's
 * track through the relay, as its file or its transcode at `kbps`.
 */
export const createMusicResolve =
  ({ sources, downloads, serverId }: CreateMusicResolveProps) =>
  async ({ mediaId, kbps }: MusicResolveProps): Promise<ResolvedSource> => {
    const server = serverId()
    const path = await downloads.trackPathOf({ serverId: server, mediaId })
    if (path !== null) {
      return { ok: true, target: { kind: PLAYER_SOURCE_KINDS.file, path, sidecars: [] } }
    }
    return sources.resolveTrack({ serverId: server, mediaId, kbps })
  }
