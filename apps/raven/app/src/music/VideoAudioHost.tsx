import { PLAYBACK_MODES, type Track } from '@raven/core'
import {
  AUDIO_HOST_COPY,
  AUDIO_STATES,
  playingTrackOf,
  startOf,
  useAudiobookSpot,
  useAudioQueue,
  useListenCounter,
  usePlayerPrefs,
  useTrackRate,
} from '@raven/ui/headless'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { StyleSheet } from 'react-native'
import Video, { type VideoRef } from 'react-native-video'

import { mediaSourcesFor } from '@/player/mediaSources'
import { watchAppHide } from '@/player/progressSink'
import type { AppQueries } from '@/queries/useAppQueries'

/** The cache key a track's ticketed address sits under, with the server and the track. */
const MUSIC_SOURCE_KEY = 'musicSource'

/** What a music host reads of the active server. */
type MusicSession = Pick<AppQueries, 'server' | 'api'>

type VideoTrackProps = {
  session: MusicSession
  track: Track
  /** How fast it plays: an audiobook's speed, or 1 for music. */
  rate: number
  /** Where it starts: an audiobook's saved spot, or 0. */
  start: number
}

/** The playing track in `react-native-video`, out of sight, from its ticketed address. */
const VideoTrack = ({ session, track, rate, start }: VideoTrackProps) => {
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
    if (source.error !== null) engine.failed(AUDIO_HOST_COPY.couldNotPlay)
  }, [source.data, source.error, engine])

  useEffect(() => {
    if (seek === null) return
    video.current?.seek(seek.seconds)
    engine.sought()
  }, [seek, engine])

  const answer = source.data
  // The length is the server's, as on every client: a player rounds a FLAC's up to whole blocks.
  return (
    answer !== undefined &&
    answer.ok && (
      <Video
        ref={video}
        muted={isMuted}
        onEnd={() => engine.ended()}
        onError={() => engine.failed(AUDIO_HOST_COPY.couldNotPlay)}
        onLoad={() => {
          const player = video.current
          if (start > 0 && player !== null) player.seek(start)
          engine.time({ position: start, duration: track.duration })
        }}
        onPlaybackStateChanged={({ isPlaying }) =>
          engine.state(isPlaying ? AUDIO_STATES.playing : AUDIO_STATES.paused)
        }
        onProgress={({ currentTime }) =>
          engine.time({ position: currentTime, duration: track.duration })
        }
        paused={state !== AUDIO_STATES.playing && state !== AUDIO_STATES.loading}
        playInBackground
        rate={rate}
        source={{ uri: answer.source.uri, headers: answer.source.headers }}
        style={styles.hidden}
        volume={volume}
      />
    )
  )
}

type VideoAudioHostProps = { session: MusicSession }

/**
 * Music on a TV: `react-native-video` out of sight, following the shared queue store one track
 * at a time, an audiobook at the prefs' speed from its saved spot and music at 1 from its top.
 * Background play and the lock screen matter little on a TV, so the TVs keep the player they have
 * for video.
 */
export const VideoAudioHost = ({ session }: VideoAudioHostProps) => {
  const track = useAudioQueue(playingTrackOf)
  const rate = useTrackRate({ api: session.api, track })
  useListenCounter({ api: session.api, track })
  // A book waits for its spot, so it never starts from the top and saves that over it.
  const start = startOf(useAudiobookSpot({ api: session.api, track, watchHide: watchAppHide }))
  return (
    track !== null &&
    start !== null && (
      <VideoTrack key={track.id} rate={rate} session={session} start={start} track={track} />
    )
  )
}

const styles = StyleSheet.create({ hidden: { width: 0, height: 0 } })
