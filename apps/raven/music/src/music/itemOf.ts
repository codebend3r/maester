import type { AudioItem } from '@raven/audio'
import {
  type ApiClient,
  type AudioPlatform,
  PLAYBACK_MODES,
  type Track,
  artistNames,
  canPlayAudio,
} from '@raven/core'
import type { MediaSources } from '@raven/native/headless'

/** What a track is played through: the server's client, for its cover, and where its media plays from. */
type AudioServer = {
  api: Pick<ApiClient, 'albumCoverUrl'>
  sources: Pick<MediaSources, 'source'>
}

type ItemOfProps = { server: AudioServer; track: Track; platform: AudioPlatform }

/**
 * A track as `@raven/audio` takes it: the file itself by its ticket, and what the lock screen
 * shows. Null for a track this device's player cannot decode (ALAC on Android, which plays
 * silent), asked of the server not at all; a rejection says why the server would not play it.
 */
export const itemOf = async ({
  server,
  track,
  platform,
}: ItemOfProps): Promise<AudioItem | null> => {
  // A track the server has not probed yet names no codec; the player is left to try it.
  if (
    track.codec !== null &&
    !canPlayAudio({ platform, codec: track.codec, container: track.container })
  ) {
    return null
  }
  const outcome = await server.sources.source({
    media: { id: track.id },
    mode: PLAYBACK_MODES.direct,
    audio: null,
    burn: null,
  })
  if (!outcome.ok) throw new Error(outcome.message)
  return {
    id: track.id,
    uri: outcome.source.uri,
    headers: outcome.source.headers,
    title: track.title,
    artist: artistNames(track),
    album: track.album.title,
    artworkUri: server.api.albumCoverUrl({
      albumId: track.albumId,
      coverVersion: track.album.coverVersion,
    }),
    duration: track.duration,
  }
}
