import { PLAYBACK_MODES, type Track } from '@raven/core'
import {
  AUDIO_STATES,
  COULD_NOT_PLAY,
  playingTrackOf,
  useAudioQueue,
  useListenCounter,
  usePlayerPrefs,
} from '@raven/ui/headless'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { StyleSheet } from 'react-native'
import Video, { type VideoRef } from 'react-native-video'

import { mediaSourcesFor } from '@/player/mediaSources'
import type { AppQueries } from '@/queries/useAppQueries'

/** The cache key a track's ticketed address sits under, with the server and the track. */
const MUSIC_SOURCE_KEY = 'musicSource'

/** What a music host reads of the active server. */
type MusicSession = Pick<AppQueries, 'server' | 'api'>

type VideoTrackProps = { session: MusicSession; track: Track }

/** The playing track in `react-native-video`, out of sight, from its ticketed address. */
const VideoTrack = ({ session, track }: VideoTrackProps) => {
  const state = useAudioQueue((store) => store.state)
  const seek = useAudioQueue((store) => store.seek)
  const engine = useAudioQueue((store) => store.engine)
  const volume = usePlayerPrefs((prefs) => prefs.volume)
  const isMuted = usePlayerPrefs((prefs) => prefs.muted)
  const video = useRef<VideoRef>(null)

  // The track's ticketed address: server data, so it lives in the query cache, read once per track.
  const source = useQuery({
    queryKey: [MUSIC_SOURCE_KEY, session.server.id, track.id],
    queryFn: () =>
      mediaSourcesFor(session.server).source({
        media: { id: track.id },
        mode: PLAYBACK_MODES.direct,
        audio: null,
        burn: null,
      }),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
    retry: false,
  })
  useEffect(() => {
    if (source.data !== undefined && !source.data.ok) engine.failed(source.data.message)
    if (source.error !== null) engine.failed(COULD_NOT_PLAY)
  }, [source.data, source.error, engine])

  useEffect(() => {
    if (seek === null) return
    video.current?.seek(seek.seconds)
    engine.sought()
  }, [seek, engine])

  if (source.data === undefined || !source.data.ok) return null
  // The length is the server's, as on every client: a player rounds a FLAC's up to whole blocks.
  return (
    <Video
      ref={video}
      muted={isMuted}
      onEnd={() => engine.ended()}
      onError={() => engine.failed(COULD_NOT_PLAY)}
      onLoad={() => engine.time({ position: 0, duration: track.duration })}
      onPlaybackStateChanged={({ isPlaying }) =>
        engine.state(isPlaying ? AUDIO_STATES.playing : AUDIO_STATES.paused)
      }
      onProgress={({ currentTime }) =>
        engine.time({ position: currentTime, duration: track.duration })
      }
      paused={state !== AUDIO_STATES.playing && state !== AUDIO_STATES.loading}
      playInBackground
      source={{ uri: source.data.source.uri, headers: source.data.source.headers }}
      style={styles.hidden}
      volume={volume}
    />
  )
}

type VideoAudioHostProps = { session: MusicSession }

/**
 * Music on a TV: `react-native-video` out of sight, following the shared queue store one track
 * at a time. Background play and the lock screen matter little on a TV, so the TVs keep the
 * player they have for video.
 */
export const VideoAudioHost = ({ session }: VideoAudioHostProps) => {
  const track = useAudioQueue(playingTrackOf)
  useListenCounter({ api: session.api, track })
  if (track === null) return null
  return <VideoTrack key={track.id} session={session} track={track} />
}

const styles = StyleSheet.create({ hidden: { width: 0, height: 0 } })
