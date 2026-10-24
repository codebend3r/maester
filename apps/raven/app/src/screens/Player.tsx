import {
  ACCESS_REFUSALS,
  type MediaItem,
  type MediaTracks,
  type PlaybackPolicy,
  ROUTE_STATES,
  activeCues,
  mediaLabel,
  planPlayback,
  resumeAtFor,
  routeIdOf,
  routeState,
} from '@raven/core'
import {
  VIDEO_EVENTS,
  initialVideoState,
  preferredAudio,
  preferredSubtitle,
  useProgressReport,
  useTrackCues,
  usePlaybackPolicy,
  usePlayerPrefs,
  useUnlockPrompt,
  videoReducer,
} from '@raven/ui/headless'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useKeepAwake } from 'expo-keep-awake'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { StyleSheet } from 'react-native'
import Video, { SelectedTrackType, type VideoRef } from 'react-native-video'

import { PlayerChrome } from '@/layouts'
import { DEVICE_SUPPORT } from '@/platform/devicePlatform'
import { mediaSourcesFor } from '@/player/mediaSources'
import { progressSinkFor, watchAppHide } from '@/player/progressSink'
import {
  SUBTITLE_CHOICES,
  audioOptionsOf,
  audioPlaceFor,
  subtitleOptionsOf,
} from '@/player/playerTracks'
import {
  SESSION_EVENTS,
  SESSION_PHASES,
  modeOf,
  noticeOf,
  sourcedOf,
  usePlaybackSession,
} from '@/player/usePlaybackSession'
import { type AppQueries, useAppQueries } from '@/queries/useAppQueries'
import { APP_ROUTE_PARAMS, secondsOf } from '@/routes'

const COPY = {
  opening: 'Opening the video',
  missing: 'This video is not on the server.',
} as const

/** How often the player says where it is, in milliseconds: often enough for a smooth clock. */
const PROGRESS_EVERY_MS = 250

/** Keeps the screen on while it is drawn. */
const StayAwake = () => {
  useKeepAwake()
  return null
}

/**
 * One video down its plan's ladder, under raven's controls: the session asks for each way's
 * source and steps down from the spot when one fails, the player's events drive the shared
 * video state, and that state drives the progress the server hears.
 */
const Playing = ({
  media,
  tracks,
  policy,
  at,
  session,
  onBack,
}: {
  media: MediaItem
  tracks: MediaTracks | null
  policy: PlaybackPolicy
  at: number
  session: AppQueries
  onBack: () => void
}) => {
  const queryClient = useQueryClient()
  const audioLanguage = usePlayerPrefs((prefs) => prefs.audioLanguage)
  const subtitlePrefs = usePlayerPrefs((prefs) => prefs.subtitles)
  const setAudioLanguage = usePlayerPrefs((prefs) => prefs.setAudioLanguage)
  const setSubtitles = usePlayerPrefs((prefs) => prefs.setSubtitles)
  const [resumeAt] = useState(() => resumeAtFor({ at, media }))
  const [subtitle, setSubtitle] = useState(() =>
    preferredSubtitle({ tracks, subtitles: subtitlePrefs }),
  )
  const plan = useMemo(
    () => planPlayback({ media, ...DEVICE_SUPPORT, defaultAudio: true, policy }),
    [media, policy],
  )
  const { state, dispatch } = usePlaybackSession({
    media,
    modes: plan.modes,
    at: resumeAt,
    audio: preferredAudio({ tracks, language: audioLanguage }),
    problems: plan.problems,
    sources: mediaSourcesFor(session.server),
  })
  const [video, dispatchVideo] = useReducer(videoReducer, resumeAt, initialVideoState)
  const position = useRef(resumeAt)
  const [duration, setDuration] = useState(media.duration)
  const [isPaused, setPaused] = useState(false)
  const player = useRef<VideoRef>(null)
  // A refetched video is a new object; the sink, and the save it waits on, stay the same.
  const { id: mediaId, libraryId } = media
  const progress = useMemo(
    () => progressSinkFor({ api: session.api, mediaId, libraryId, queryClient }),
    [session.api, mediaId, libraryId, queryClient],
  )
  const mode = modeOf(state)
  const ladder = state.phase === SESSION_PHASES.failed ? null : state
  const audioPlaying = ladder?.audio ?? tracks?.defaultAudio ?? null
  useProgressReport({
    state: video,
    position,
    duration,
    audio: audioPlaying,
    resumeAt,
    progress,
    watchHide: watchAppHide,
  })
  const sourced = sourcedOf(state)
  const audioPlace =
    tracks === null || mode === null
      ? null
      : audioPlaceFor({ mode, tracks, audio: ladder?.audio ?? null })
  const subtitleTrack =
    tracks?.subtitles.find((track) => track.supported && track.id === subtitle) ?? null
  const { cues } = useTrackCues({
    video: { api: session.api, mediaId: media.id },
    track: subtitleTrack,
    time: video.time,
    duration,
  })
  const showing = activeCues({ cues, time: video.time })
  const startAt = ladder?.at ?? resumeAt
  const attempt = ladder?.attempt ?? null

  // The session hands out a new source for each attempt, which the player loads from its spot.
  const source = useMemo(
    () =>
      sourced === null
        ? null
        : {
            uri: sourced.source.uri,
            headers: sourced.source.headers,
            startPosition: startAt * 1000,
          },
    [sourced, startAt],
  )

  const refusal = state.phase === SESSION_PHASES.refused ? state.refusal : null
  useEffect(() => {
    if (refusal !== null && refusal.reason === ACCESS_REFUSALS.locked) {
      useUnlockPrompt.getState().ask()
    }
  }, [refusal])

  const seek = (to: number) => {
    const current = player.current
    if (current === null) return
    const target = Math.min(Math.max(0, to), duration ?? to)
    current.seek(target)
    position.current = target
    dispatchVideo({ type: VIDEO_EVENTS.sought, time: target })
  }

  const togglePlay = () => {
    if (video.ended) {
      seek(0)
      setPaused(false)
      return
    }
    setPaused((paused) => !paused)
  }

  const enterPictureInPicture = () => {
    const current = player.current
    if (current !== null) current.enterPictureInPicture()
  }

  const pickAudio = (key: string) => {
    const track = tracks?.audio.find((each) => String(each.index) === key) ?? null
    if (track === null) return
    setAudioLanguage(track.language)
    dispatch({ type: SESSION_EVENTS.audioPicked, audio: track.index, at: position.current })
  }

  const pickSubtitle = (key: string) => {
    const id = key === SUBTITLE_CHOICES.off ? null : key
    const track = tracks?.subtitles.find((each) => each.id === id) ?? null
    setSubtitles({ on: id !== null, language: track?.language ?? subtitlePrefs.language })
    setSubtitle(id)
  }

  const subtitleOptions = tracks === null ? [] : subtitleOptionsOf(tracks)
  const surface = source !== null && attempt !== null && (
    <Video
      ref={player}
      allowsExternalPlayback
      controls={false}
      enterPictureInPictureOnLeave
      ignoreSilentSwitch="ignore"
      onBuffer={({ isBuffering }) =>
        dispatchVideo({ type: isBuffering ? VIDEO_EVENTS.waiting : VIDEO_EVENTS.flowing })
      }
      onEnd={() => {
        setPaused(true)
        dispatchVideo({ type: VIDEO_EVENTS.ended })
      }}
      onError={() => dispatch({ type: SESSION_EVENTS.failed, attempt, at: position.current })}
      onLoad={({ duration: length }) => {
        if (length > 0) setDuration(length)
        dispatchVideo({ type: VIDEO_EVENTS.duration, duration: length > 0 ? length : null })
        dispatch({ type: SESSION_EVENTS.loaded, attempt })
      }}
      onPlaybackStateChanged={({ isPlaying }) =>
        dispatchVideo({ type: isPlaying ? VIDEO_EVENTS.played : VIDEO_EVENTS.paused })
      }
      onProgress={({ currentTime }) => {
        position.current = currentTime
        dispatchVideo({ type: VIDEO_EVENTS.moved, time: currentTime, buffered: [] })
      }}
      paused={isPaused}
      playInBackground={false}
      progressUpdateInterval={PROGRESS_EVERY_MS}
      resizeMode="contain"
      selectedAudioTrack={
        audioPlace === null ? undefined : { type: SelectedTrackType.INDEX, value: audioPlace }
      }
      // raven draws the cues itself, from the server's WebVTT, as the web does: the player's
      // own rendition is never picked, so it never draws a second.
      selectedTextTrack={{ type: SelectedTrackType.DISABLED }}
      source={source}
      style={StyleSheet.absoluteFill}
    />
  )

  return (
    <>
      {!video.paused && !video.ended && <StayAwake />}
      <PlayerChrome
        caption={showing.length === 0 ? null : showing.map((cue) => cue.text).join('\n')}
        audio={
          tracks === null || tracks.audio.length < 2 || ladder === null
            ? null
            : {
                options: audioOptionsOf(tracks),
                value: audioPlaying === null ? '' : String(audioPlaying),
                onChoose: pickAudio,
              }
        }
        notice={noticeOf(state)}
        onBack={onBack}
        onPictureInPicture={source === null ? null : enterPictureInPicture}
        subtitles={
          subtitleOptions.length < 2 || ladder === null
            ? null
            : {
                options: subtitleOptions,
                value: subtitle ?? SUBTITLE_CHOICES.off,
                onChoose: pickSubtitle,
              }
        }
        surface={surface}
        title={mediaLabel(media)}
        transport={
          source === null
            ? null
            : { isPaused, position: video.time, duration, onTogglePlay: togglePlay, onSeek: seek }
        }
      />
    </>
  )
}

/** A video once the server's playback settings and its tracks are known. */
const ReadyPlayer = ({
  media,
  at,
  session,
  onBack,
}: {
  media: MediaItem
  at: number
  session: AppQueries
  onBack: () => void
}) => {
  const policy = usePlaybackPolicy({ queries: session.queries })
  const tracks = useQuery(session.queries.tracksQuery(media.id))
  const title = mediaLabel(media)
  if (policy === null || tracks.isPending) {
    return <Waiting notice={COPY.opening} onBack={onBack} title={title} />
  }
  // A file whose tracks cannot be read still plays, with no pickers.
  return (
    <Playing
      at={at}
      media={media}
      onBack={onBack}
      policy={policy}
      session={session}
      tracks={tracks.data ?? null}
    />
  )
}

/** The player's chrome with only a line on it and Back. */
const Waiting = ({
  title,
  notice,
  onBack,
}: {
  title: string
  notice: string
  onBack: () => void
}) => (
  <PlayerChrome
    audio={null}
    caption={null}
    notice={notice}
    onBack={onBack}
    onPictureInPicture={null}
    subtitles={null}
    surface={null}
    title={title}
    transport={null}
  />
)

const ServerPlayer = ({
  session,
  mediaId,
  at,
}: {
  session: AppQueries
  mediaId: number | null
  at: number
}) => {
  const router = useRouter()
  const onBack = () => router.back()
  const page = routeState({ id: mediaId, query: useQuery(session.queries.mediaQuery(mediaId)) })
  switch (page.state) {
    case ROUTE_STATES.missing:
      return <Waiting notice={COPY.missing} onBack={onBack} title="" />
    case ROUTE_STATES.error:
      return <Waiting notice={page.message} onBack={onBack} title="" />
    case ROUTE_STATES.loading:
      return <Waiting notice={COPY.opening} onBack={onBack} title="" />
    case ROUTE_STATES.ready:
      return (
        <ReadyPlayer
          key={page.data.id}
          at={at}
          media={page.data}
          onBack={onBack}
          session={session}
        />
      )
    default: {
      const unknown: never = page
      return unknown
    }
  }
}

/**
 * `/play/[mediaId]`: a video under raven's controls, from the spot `?at=` names (Resume's) or
 * where the server last saved, down the ladder of ways the server offers.
 */
export const Player = () => {
  const params = useLocalSearchParams()
  const mediaId = routeIdOf(params[APP_ROUTE_PARAMS.mediaId])
  const at = secondsOf(params[APP_ROUTE_PARAMS.at])
  const session = useAppQueries()
  return (
    session !== null && (
      <ServerPlayer key={session.server.id} at={at} mediaId={mediaId} session={session} />
    )
  )
}
