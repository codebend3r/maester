import type { ApiClient, Track, TrackStream } from '@raven/core'
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
import { useEffect, useMemo, useRef } from 'react'
import { StyleSheet } from 'react-native'
import Video, { type VideoRef } from 'react-native-video'

import { watchAppHide } from '@/player/watchAppHide'
import type { SourceOutcome } from '@/servers/mediaAccess'
import type { AppServer } from '@/servers/serverList'
import { usePlayedStreams } from '@/stores/playedStreams'

/** What a TV's music host reads of the active server. */
type MusicSession = { server: AppServer; api: ApiClient }

/** Where a track plays from on a TV, as the app asks for it. */
export type VideoTrackSource = {
  /** The cache key its ticketed address sits under, with the server and the track. */
  key: string
  /** Makes its ticketed address, or says why the server would not play it. */
  load: () => Promise<SourceOutcome>
  /** What it plays from once the address is made, for a player that shows it. */
  stream: TrackStream
}

/** Where each track plays from: made by the app, which knows what its server is asked. */
export type VideoTrackSourceOf = (track: Track) => VideoTrackSource

type VideoTrackProps = {
  session: MusicSession
  sourceOf: VideoTrackSourceOf
  track: Track
  /** How fast it plays: an audiobook's speed, or 1 for music. */
  rate: number
  /** Where it starts: an audiobook's saved spot, or 0. */
  start: number
}

/** The playing track in `react-native-video`, out of sight, from its ticketed address. */
const VideoTrack = ({ session, sourceOf, track, rate, start }: VideoTrackProps) => {
  const shouldPlay = useAudioQueue((store) => store.shouldPlay)
  const seek = useAudioQueue((store) => store.seek)
  const engine = useAudioQueue((store) => store.engine)
  const volume = usePlayerPrefs((prefs) => prefs.volume)
  const isMuted = usePlayerPrefs((prefs) => prefs.muted)
  const heard = usePlayedStreams((played) => played.heard)
  const video = useRef<VideoRef>(null)
  const plan = useMemo(() => sourceOf(track), [sourceOf, track])

  // The track's ticketed address: server data, so it lives in the query cache, read once per track.
  const source = useQuery({
    queryKey: [plan.key, session.server.id, track.id],
    queryFn: plan.load,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
    retry: false,
  })
  useEffect(() => {
    if (source.data !== undefined && !source.data.ok) engine.failed(source.data.message)
    if (source.error !== null) engine.failed(AUDIO_HOST_COPY.couldNotPlay)
  }, [source.data, source.error, engine])

  const hasSource = !!source.data?.ok
  useEffect(() => {
    if (hasSource) heard({ trackId: track.id, stream: plan.stream })
  }, [hasSource, heard, track.id, plan.stream])

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

type VideoAudioHostProps = {
  session: MusicSession
  /** Where each track plays from; kept stable across renders, as each track asks it once. */
  sourceOf: VideoTrackSourceOf
}

/**
 * Music on a TV, raven's and Wren's: `react-native-video` out of sight, following the shared
 * queue store one track at a time, an audiobook at the prefs' speed from its saved spot and music
 * at 1 from its top. Background play and the lock screen matter little on a TV, so the TVs keep
 * the player they have for video.
 */
export const VideoAudioHost = ({ session, sourceOf }: VideoAudioHostProps) => {
  const track = useAudioQueue(playingTrackOf)
  const rate = useTrackRate({ api: session.api, track })
  useTrackListening({ api: session.api, track })
  // A book waits for its spot, so it never starts from the top and saves that over it.
  const start = startOf(useAudiobookSpot({ api: session.api, track, watchHide: watchAppHide }))
  return (
    track !== null &&
    start !== null && (
      <VideoTrack
        key={track.id}
        rate={rate}
        session={session}
        sourceOf={sourceOf}
        start={start}
        track={track}
      />
    )
  )
}

const styles = StyleSheet.create({ hidden: { width: 0, height: 0 } })
