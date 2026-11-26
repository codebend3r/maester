import { DEVICE_AUDIO_PLATFORM, VideoAudioHost, type VideoTrackSourceOf } from '@raven/native'
import { trackStreamOf } from '@raven/native/headless'
import { type WrenSession, mediaSourcesFor } from '@raven/wren-native'
import { useMemo } from 'react'

/** The cache keys a track's ticketed address sits under, with the server and the track. */
const TRACK_SOURCE_KEYS = { tv: 'wrenTvTrackSource' } as const

/** What the music host reads of the active server. */
type MusicSession = Pick<WrenSession, 'server' | 'api'>

type TvMusicHostProps = { session: MusicSession }

/**
 * Music on a TV through `@raven/native`'s `VideoAudioHost`, as raven's TV app plays it: each
 * track from the server's own address by its ticket, the file, or the AAC transcode where this
 * TV's player cannot decode the file. A TV has no downloads and no mobile network, so no bitrate
 * is ever chosen.
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
        key: TRACK_SOURCE_KEYS.tv,
        load: () => mediaSourcesFor(server).trackSource({ mediaId: track.id, kbps }),
        stream,
      }
    },
    [server],
  )
  return <VideoAudioHost session={session} sourceOf={sourceOf} />
}
