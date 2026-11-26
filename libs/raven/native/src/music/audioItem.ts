import type { AudioItem } from '@raven/audio'
import {
  type ApiClient,
  type AudioBitrate,
  type AudioPlatform,
  TRACK_STREAM_KINDS,
  type Track,
  type TrackStream,
  artistNames,
} from '@raven/core'

import { trackStreamOf } from '@/music/trackStream'
import type { MediaSources } from '@/servers/mediaAccess'

/** What a track is played through: the server's client, for its cover, and where its media plays from. */
type AudioServer = {
  api: Pick<ApiClient, 'albumCoverUrl'>
  sources: Pick<MediaSources, 'trackSource'>
}

/**
 * A track on this device: its file, and the album cover saved beside it (null for none), as
 * `file://` addresses, and the bitrate it was transcoded to (null for the file itself, kept whole).
 */
type DownloadedTrack = { uri: string; artworkUri: string | null; kbps: AudioBitrate | null }

type OnStreamProps = { track: Track; stream: TrackStream }

/** What this device would play a track from before the server's file: a download, or a smaller stream. */
export type TrackPlan = {
  /** The track's download, or null when it is not on this device. */
  downloadedOf: (track: Track) => DownloadedTrack | null
  /** The bitrate the listener chose for this network (a transcode on cellular), or null for none. */
  streamKbps: () => Promise<AudioBitrate | null>
  /** Told what each track plays from as its source is made, for a player that shows it. */
  onStream: (props: OnStreamProps) => void
}

type AudioItemOfProps = {
  server: AudioServer
  track: Track
  platform: AudioPlatform
  plan: TrackPlan
}

/**
 * A track as `@raven/audio` takes it, and what the lock screen shows. It plays, in order: the
 * downloaded file and the cover saved with it, with no headers and nothing asked of the server;
 * else from the server's own address by its ticket, the transcode at the listener's chosen bitrate,
 * the transcode at 256 kbps for a file this player cannot decode, or the file itself. Where the
 * device is, at home or away, is never asked. A rejection says why the server would not play it.
 */
export const audioItemOf = async ({
  server,
  track,
  platform,
  plan,
}: AudioItemOfProps): Promise<AudioItem> => {
  const details = {
    id: track.id,
    title: track.title,
    artist: artistNames(track),
    album: track.album.title,
    artworkUri: server.api.albumCoverUrl({
      albumId: track.albumId,
      coverVersion: track.album.coverVersion,
    }),
    duration: track.duration,
  }
  const downloaded = plan.downloadedOf(track)
  if (downloaded !== null) {
    plan.onStream({
      track,
      stream: { kind: TRACK_STREAM_KINDS.download, kbps: downloaded.kbps },
    })
    return {
      ...details,
      uri: downloaded.uri,
      headers: {},
      artworkUri: downloaded.artworkUri ?? details.artworkUri,
    }
  }
  const { kbps, stream } = trackStreamOf({
    track,
    platform,
    chosenKbps: await plan.streamKbps(),
  })
  const outcome = await server.sources.trackSource({ mediaId: track.id, kbps })
  if (!outcome.ok) throw new Error(outcome.message)
  plan.onStream({ track, stream })
  return { ...details, uri: outcome.source.uri, headers: outcome.source.headers }
}
