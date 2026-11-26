import type { Track } from '@raven/core'
import { watchAppHide } from '@raven/native'
import { usePlayedStreams } from '@raven/native/headless'
import {
  AUDIO_HOST_COPY,
  AUDIO_STATES,
  playingTrackOf,
  startOf,
  useAudiobookSpot,
  useAudioQueue,
  usePlayerPrefs,
  useTrackListening,
  useTrackRate,
} from '@raven/ui/headless'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { Platform, StyleSheet } from 'react-native'
import Video, { type VideoRef } from 'react-native-video'

import { audioPlatformOf } from '@/music/audioPlatform'
import { mediaSourcesFor, type WrenSession } from '@raven/wren-native'
import { trackRequestOf } from '@/music/trackRequest'

/** The cache key a track's ticketed address sits under, with the server and the track. */
const TRACK_SOURCE_KEY = 'wrenTvTrackSource'

const AUDIO_PLATFORM = audioPlatformOf({ os: Platform.OS })

/** What the music host reads of the active server. */
type MusicSession = Pick<WrenSession, 'server' | 'api'>

type VideoTrackProps = {
  session: MusicSession
  track: Track
  /** How fast it plays: an audiobook's speed, or 1 for music. */
  rate: number
  /** Where it starts: an audiobook's saved spot, or 0. */
  start: number
}

/**
 * The playing track in `react-native-video`, out of sight, from the server's own address by its
 * ticket: the file, or the AAC transcode where this TV's player cannot decode the file.
 */
const VideoTrack = ({ session, track, rate, start }: VideoTrackProps) => {
  const shouldPlay = useAudioQueue((store) => store.shouldPlay)
  const seek = useAudioQueue((store) => store.seek)
  const engine = useAudioQueue((store) => store.engine)
  const volume = usePlayerPrefs((prefs) => prefs.volume)
  const isMuted = usePlayerPrefs((prefs) => prefs.muted)
  const heard = usePlayedStreams((played) => played.heard)
  const video = useRef<VideoRef>(null)
  const request = trackRequestOf({ track, platform: AUDIO_PLATFORM })

  // The track's ticketed address: server data, so it lives in the query cache, read once per track.
  const source = useQuery({
    queryKey: [TRACK_SOURCE_KEY, session.server.id, track.id],
    queryFn: () =>
      mediaSourcesFor(session.server).trackSource({ mediaId: track.id, kbps: request.kbps }),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
    retry: false,
  })
  const hasSource = !!source.data?.ok
  useEffect(() => {
    if (source.data !== undefined && !source.data.ok) engine.failed(source.data.message)
    if (source.error !== null) engine.failed(AUDIO_HOST_COPY.couldNotPlay)
  }, [source.data, source.error, engine])
  useEffect(() => {
    if (hasSource) heard({ trackId: track.id, stream: request.stream })
  }, [hasSource, heard, track.id, request.stream])
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
        paused={!shouldPlay}
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
 * Music on a TV, as raven's TV app plays it: `react-native-video` out of sight, following the
 * shared queue store one track at a time, an audiobook at the prefs' speed from its saved spot
 * and music at 1 from its top. A TV has no lock screen, so the player it has for video does.
 */
export const VideoAudioHost = ({ session }: VideoAudioHostProps) => {
  const track = useAudioQueue(playingTrackOf)
  const rate = useTrackRate({ api: session.api, track })
  useTrackListening({ api: session.api, track })
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
