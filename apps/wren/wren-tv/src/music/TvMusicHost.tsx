import { DEVICE_AUDIO_PLATFORM, VideoAudioHost, type VideoTrackSourceOf } from '@raven/native'
import { trackStreamOf } from '@raven/native/headless'
import {
  type WrenSession,
  deviceSpotFor,
  mediaSourcesFor,
  useKeepSongProgress,
} from '@raven/wren-native'
import { useMemo } from 'react'

/** What the music host reads of the active server. */
type MusicSession = Pick<WrenSession, 'server' | 'api'>

type TvMusicHostProps = { session: MusicSession }

/**
 * Music on a TV through `@raven/native`'s `VideoAudioHost`, as raven's TV app plays it: each
 * track from the server's own address by its ticket, the file, or the AAC transcode where this
 * TV's player cannot decode the file. A TV has no downloads and no mobile network, so no bitrate
 * is ever chosen. Each song's progress is kept on the TV, and a song starts where it was left.
 */
export const TvMusicHost = ({ session }: TvMusicHostProps) => {
  const { server } = session
  const sourceOf = useMemo(
    (): VideoTrackSourceOf => (track) => {
      const { kbps, stream } = trackStreamOf({
        track,
        platform: DEVICE_AUDIO_PLATFORM,
        chosenKbps: null,
      })
      return {
        load: () => mediaSourcesFor(server).trackSource({ mediaId: track.id, kbps }),
        stream,
      }
    },
    [server],
  )
  useKeepSongProgress({ serverId: server.id })
  const deviceSpotOf = useMemo(() => deviceSpotFor({ serverId: server.id }), [server.id])
  return <VideoAudioHost deviceSpotOf={deviceSpotOf} session={session} sourceOf={sourceOf} />
}
