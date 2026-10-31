import type { AudioItem } from '@raven/audio'
import {
  AUDIO_BITRATES,
  type ApiClient,
  type AudioBitrate,
  type AudioPlatform,
  type Track,
  artistNames,
  canPlayAudio,
} from '@raven/core'

import type { MediaSources } from '@/servers/mediaAccess'

/** What a track is played through: the server's client, for its cover, and where its media plays from. */
type AudioServer = {
  api: Pick<ApiClient, 'albumCoverUrl'>
  sources: Pick<MediaSources, 'trackSource'>
}

/** What this device would play a track from before the server's file: a download, or a smaller stream. */
export type TrackPlan = {
  /** The downloaded file's `file://` address, or null when the track is not on this device. */
  downloadedUriOf: (track: Track) => string | null
  /** The bitrate the network calls for (a transcode on cellular), or null for the file itself. */
  streamKbps: () => Promise<AudioBitrate | null>
}

/** A device that downloads nothing and always streams the file itself: the device app. */
export const SERVER_FILE_PLAN: TrackPlan = {
  downloadedUriOf: () => null,
  streamKbps: async () => null,
}

type AudioItemOfProps = {
  server: AudioServer
  track: Track
  platform: AudioPlatform
  plan: TrackPlan
}

/**
 * A track as `@raven/audio` takes it, and what the lock screen shows. It plays, in order: the
 * downloaded file, with no headers and nothing asked of the server; the AAC transcode at the
 * bitrate the network calls for; else the file itself by its ticket. A file this device's player
 * cannot decode (ALAC on Android, which plays silent) plays from the transcode at 256 kbps
 * instead. A rejection says why the server would not play it.
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
  const downloaded = plan.downloadedUriOf(track)
  if (downloaded !== null) return { ...details, uri: downloaded, headers: {} }
  // A track the server has not probed yet names no codec; the player is left to try it.
  const canDecode =
    track.codec === null ||
    canPlayAudio({ platform, codec: track.codec, container: track.container })
  const kbps = (await plan.streamKbps()) ?? (canDecode ? null : AUDIO_BITRATES.standard)
  const outcome = await server.sources.trackSource({ mediaId: track.id, kbps })
  if (!outcome.ok) throw new Error(outcome.message)
  return { ...details, uri: outcome.source.uri, headers: outcome.source.headers }
}
