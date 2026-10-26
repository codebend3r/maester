import {
  ACCESS_REFUSALS,
  ITEM_IMAGE_KINDS,
  type MediaItem,
  type MediaTracks,
  type PlaybackMode,
  type PlaybackPolicy,
  ROUTE_STATES,
  type SubtitleTrack,
  activeCues,
  mediaLabel,
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
import { SelectedTrackType, type VideoRef } from 'react-native-video'

import { PlayerChrome, shouldDrawCaptions } from '@/layouts'
import type { VideoSurface } from '@/layouts/playerKit'
import { DEVICE_PLATFORM } from '@/platform/devicePlatform'
import { planFor } from '@/platform/playbackPlan'
import { mediaSourcesFor } from '@/player/mediaSources'
import { isServerDrop } from '@/player/playerErrors'
import { progressSinkFor, watchAppHide } from '@/player/progressSink'
import {
  AUDIO_HEARINGS,
  type AudioHearing,
  type HeardAudio,
  hearAudio,
  isAudioDropped,
} from '@/player/droppedAudio'
import {
  SUBTITLE_CHOICES,
  audioOptionsOf,
  audioPlaceFor,
  subtitleOptionsOf,
  subtitlePlaceFor,
} from '@/player/playerTracks'
import {
  SESSION_EVENTS,
  SESSION_PHASES,
  hasWayBelow,
  modeOf,
  noticeOf,
  sourcedOf,
  usePlaybackSession,
} from '@/player/usePlaybackSession'
import { imageOf } from '@/queries/cards'
import { type AppQueries, useAppQueries } from '@/queries/useAppQueries'
import { APP_ROUTE_PARAMS, secondsOf } from '@/routes'
import { useAppPrefs } from '@/stores/appPrefs'

const COPY = {
  opening: 'Opening the video',
  missing: 'This video is not on the server.',
} as const

/** How often the player says where it is, in milliseconds: often enough for a smooth clock. */
const PROGRESS_EVERY_MS = 250

type CaptionsForProps = {
  mode: PlaybackMode | null
  tracks: MediaTracks | null
  subtitle: string | null
}

/**
 * Who draws the picked subtitle. Where the chrome draws the cues, raven reads them from
 * `cueTrack`, and the player's own rendition is never picked, so it never draws a second.
 * Elsewhere the player draws the stream's rendition at the track's place (`textTrack`), or with
 * none picked, what it chooses itself (a forced track, the system's settings).
 */
const captionsFor = ({
  mode,
  tracks,
  subtitle,
}: CaptionsForProps): {
  cueTrack: SubtitleTrack | null
  textTrack: VideoSurface['selectedTextTrack']
} => {
  if (shouldDrawCaptions) {
    return {
      cueTrack: tracks?.subtitles.find((track) => track.supported && track.id === subtitle) ?? null,
      textTrack: { type: SelectedTrackType.DISABLED },
    }
  }
  const place =
    tracks === null || mode === null ? null : subtitlePlaceFor({ mode, tracks, subtitle })
  return {
    cueTrack: null,
    textTrack: place === null ? undefined : { type: SelectedTrackType.INDEX, value: place },
  }
}

/** Keeps the screen on while it is drawn. */
const StayAwake = () => {
  useKeepAwake()
  return null
}

type PlayingProps = {
  media: MediaItem
  tracks: MediaTracks | null
  summary: string | null
  policy: PlaybackPolicy
  at: number
  session: AppQueries
  onBack: () => void
}

/**
 * One video down its plan's ladder, under the platform's chrome: the session asks for each way's
 * source and steps down from the spot when one fails, the player's events drive the shared
 * video state, and that state drives the progress the server hears.
 */
const Playing = ({ media, tracks, summary, policy, at, session, onBack }: PlayingProps) => {
  const queryClient = useQueryClient()
  const audioLanguage = usePlayerPrefs((prefs) => prefs.audioLanguage)
  const subtitlePrefs = usePlayerPrefs((prefs) => prefs.subtitles)
  const setAudioLanguage = usePlayerPrefs((prefs) => prefs.setAudioLanguage)
  const setSubtitles = usePlayerPrefs((prefs) => prefs.setSubtitles)
  const [resumeAt] = useState(() => resumeAtFor({ at, media }))
  const [subtitle, setSubtitle] = useState(() =>
    preferredSubtitle({ tracks, subtitles: subtitlePrefs }),
  )
  const shouldPreferDirectPlay = useAppPrefs((prefs) => prefs.shouldPreferDirectPlay)
  const isTranscodeAllowed = useAppPrefs((prefs) => prefs.isTranscodeAllowed)
  const plan = useMemo(
    () =>
      planFor({
        platform: DEVICE_PLATFORM,
        media,
        tracks,
        policy,
        prefs: { shouldPreferDirectPlay, isTranscodeAllowed },
        shouldDrawCaptions,
      }),
    [media, tracks, policy, shouldPreferDirectPlay, isTranscodeAllowed],
  )
  const [video, dispatchVideo] = useReducer(videoReducer, resumeAt, initialVideoState)
  const [isPaused, setPaused] = useState(false)
  const position = useRef(resumeAt)
  const { state, dispatch } = usePlaybackSession({
    media,
    modes: plan.modes,
    at: resumeAt,
    audio: preferredAudio({ tracks, language: audioLanguage }),
    problems: plan.problems,
    sources: mediaSourcesFor(session.server),
    // AVPlayer says it waits at the end of a file too, and the viewer's pause is no stall.
    isWaiting: video.waiting && !isPaused && !video.ended,
    clock: video.time,
  })
  const [duration, setDuration] = useState(media.duration)
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
  const captions = captionsFor({ mode, tracks, subtitle })
  const { cues } = useTrackCues({
    video: { api: session.api, mediaId: media.id },
    track: captions.cueTrack,
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

  // ExoPlayer may play the original without the audio asked for, saying nothing: once the pick
  // has settled, a play with a way left below steps down when it did.
  const heardAudio = useRef<HeardAudio | null>(null)
  const hear = (hearing: AudioHearing) => {
    const { heard, toJudge } = hearAudio({ heard: heardAudio.current, hearing })
    heardAudio.current = heard
    if (toJudge === null || state.phase !== SESSION_PHASES.playing || !hasWayBelow(state)) return
    if (isAudioDropped({ platform: DEVICE_PLATFORM, mode, place: audioPlace, reported: toJudge })) {
      dispatch({ type: SESSION_EVENTS.failed, attempt: hearing.attempt, at: position.current })
    }
  }

  // A seek before the video has loaded is lost by the player, so it is not taken at all.
  const seek = (to: number) => {
    const current = player.current
    if (current === null || state.phase !== SESSION_PHASES.playing) return
    const target = Math.min(Math.max(0, to), duration ?? to)
    current.seek(target)
    position.current = target
    dispatchVideo({ type: VIDEO_EVENTS.sought, time: target })
    hear({ type: AUDIO_HEARINGS.sought, attempt: state.attempt, clock: target })
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
  const surface: VideoSurface | null =
    source === null || attempt === null
      ? null
      : {
          ref: player,
          onBuffer: ({ isBuffering }) =>
            dispatchVideo({ type: isBuffering ? VIDEO_EVENTS.waiting : VIDEO_EVENTS.flowing }),
          onEnd: () => {
            setPaused(true)
            dispatchVideo({ type: VIDEO_EVENTS.ended })
          },
          // The server letting go of the source (a ticket past its life, an HLS session it ended)
          // opens the same way again from the spot; any other failure steps down the ladder.
          onError: (failure) =>
            dispatch({
              type: isServerDrop(failure) ? SESSION_EVENTS.dropped : SESSION_EVENTS.failed,
              attempt,
              at: position.current,
            }),
          onAudioTracks: ({ audioTracks }) =>
            hear({ type: AUDIO_HEARINGS.tracks, attempt, reported: audioTracks }),
          onLoad: ({ duration: length, audioTracks }) => {
            hear({ type: AUDIO_HEARINGS.loaded, attempt, reported: audioTracks, place: audioPlace })
            if (length > 0) setDuration(length)
            dispatchVideo({ type: VIDEO_EVENTS.duration, duration: length > 0 ? length : null })
            dispatch({ type: SESSION_EVENTS.loaded, attempt })
          },
          // AVPlayer says its buffer ran full only after it ran empty, which a fast stream never
          // does, so playing is also what says frames flow; without it the play never starts.
          onPlaybackStateChanged: ({ isPlaying }) => {
            dispatchVideo({ type: isPlaying ? VIDEO_EVENTS.played : VIDEO_EVENTS.paused })
            if (isPlaying) dispatchVideo({ type: VIDEO_EVENTS.flowing })
          },
          onProgress: ({ currentTime }) => {
            position.current = currentTime
            dispatchVideo({ type: VIDEO_EVENTS.moved, time: currentTime, buffered: [] })
            hear({ type: AUDIO_HEARINGS.moved, attempt, clock: currentTime })
          },
          paused: isPaused,
          progressUpdateInterval: PROGRESS_EVERY_MS,
          selectedAudioTrack:
            audioPlace === null ? undefined : { type: SelectedTrackType.INDEX, value: audioPlace },
          selectedTextTrack: captions.textTrack,
          source,
        }
  const artwork =
    imageOf({ api: session.api, item: media.item, kind: ITEM_IMAGE_KINDS.poster }) ??
    session.api.thumbnailUrl(media)

  return (
    <>
      {!video.paused && !video.ended && <StayAwake />}
      <PlayerChrome
        artwork={artwork}
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
        summary={summary}
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

type ReadyPlayerProps = {
  media: MediaItem
  at: number
  session: AppQueries
  onBack: () => void
}

/** A video once the server's playback settings and its tracks are known. */
const ReadyPlayer = ({ media, at, session, onBack }: ReadyPlayerProps) => {
  const policy = usePlaybackPolicy({ queries: session.queries })
  const tracks = useQuery(session.queries.tracksQuery(media.id))
  // Read before the source is handed over, which carries the synopsis on a TV: a source that
  // changes once playing reloads the video.
  const details = useQuery(session.queries.itemQuery(media.item?.id ?? null))
  const title = mediaLabel(media)
  if (policy === null || tracks.isPending || details.isLoading) {
    return <Waiting notice={COPY.opening} onBack={onBack} title={title} />
  }
  // A file whose tracks or page cannot be read still plays, with no pickers or synopsis.
  return (
    <Playing
      at={at}
      media={media}
      onBack={onBack}
      policy={policy}
      session={session}
      summary={details.data?.summary ?? null}
      tracks={tracks.data ?? null}
    />
  )
}

type WaitingProps = {
  title: string
  notice: string
  onBack: () => void
}

/** The player's chrome with only a line on it and Back. */
const Waiting = ({ title, notice, onBack }: WaitingProps) => (
  <PlayerChrome
    artwork={null}
    audio={null}
    caption={null}
    notice={notice}
    onBack={onBack}
    onPictureInPicture={null}
    subtitles={null}
    summary={null}
    surface={null}
    title={title}
    transport={null}
  />
)

type ServerPlayerProps = {
  session: AppQueries
  mediaId: number | null
  at: number
}

const ServerPlayer = ({ session, mediaId, at }: ServerPlayerProps) => {
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
