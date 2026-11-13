import {
  type Chapter,
  DEFAULT_PLAYBACK_SETTINGS,
  ITEM_IMAGE_KINDS,
  ITEM_TYPES,
  PLAYBACK_MODES,
  type MediaItem,
  type ViewingSession,
  activeCues,
  asksServerForNext,
  episodeCode,
  isPictureSubtitle,
  mediaLabel,
  resumeAtFor,
  SESSION_KINDS,
  episodeTag,
  preferredAudio,
  preferredSubtitle,
} from '@raven/core'
import { watchAppHide } from '@raven/native'
import {
  VIDEO_EVENTS,
  initialVideoState,
  useCaptionStyle,
  useProgressReport,
  useTrackCues,
  usePlayerPrefs,
  videoReducer,
} from '@raven/ui/headless'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useKeepAwake } from 'expo-keep-awake'
import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { SelectedTrackType, type VideoRef } from 'react-native-video'

import { PlayerChrome, canDrawPictureSubtitles, shouldDrawCaptions } from '@/layouts'
import { PLAYER_COPY, type VideoSurface } from '@/layouts/playerKit'
import { DEVICE_PLATFORM, DEVICE_TRAITS } from '@/platform/devicePlatform'
import { captionsFor, sidecarIdsOf, sidecarTracksOf } from '@/player/captions'
import { playerSubtitleStyleOf } from '@/player/captionLook'
import { PLAYER_BUFFER } from '@/player/playerBuffer'
import { isServerDrop } from '@/player/playerErrors'
import type { PlayWay } from '@/player/playWay'
import { progressSinkFor } from '@/player/progressSink'
import { NOT_LOADED, START_EVENTS, isHeldOf, isStartedOf, startReducer } from '@/player/startUp'
import {
  PICTURE_HEARINGS,
  type PictureHearing,
  type PictureWatch,
  watchPicture,
} from '@/player/missingPicture'
import { useSeekGrace } from '@/player/useSeekGrace'
import { viewingOf } from '@/player/viewing'
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
  picturesFor,
  subtitleOptionsOf,
} from '@/player/playerTracks'
import { pickedQualityOf, qualityKeyOf, qualityOptionsOf } from '@/player/qualityOptions'
import {
  SESSION_EVENTS,
  SESSION_PHASES,
  hasWayBelow,
  isOpeningOf,
  modeOf,
  noticeOf,
  sourcedOf,
  usePlaybackSession,
} from '@/player/usePlaybackSession'
import { imageOf } from '@/queries/cards'
import { usePlayerHeading } from '@/queries/usePlayerHeading'
import type { AppQueries } from '@/queries/useAppQueries'
import { queueNeighbourOf, useVideoQueue } from '@/stores/videoQueue'
import { useWatching } from '@/stores/watching'

/** How often the player says where it is, in milliseconds: often enough for a smooth clock. */
const PROGRESS_EVERY_MS = 250

const NO_CHAPTERS: readonly Chapter[] = []

type VideoLabelOfProps = { word: string; media: MediaItem }

/** "Previous The Matrix": what a shuffle's next or previous is called aloud. */
const videoLabelOf = ({ word, media }: VideoLabelOfProps): string => `${word} ${media.title}`

/** "Next episode, S01E03 Half Loop": what the Next button is called aloud. */
const nextLabelOf = (next: MediaItem): string =>
  [PLAYER_COPY.next, next.item === null ? null : episodeCode(next.item), next.title]
    .filter((part): part is string => part !== null)
    .join(' ')

/** "Lucky · S01 · E02 · Make 'em Dance": what plays next, as the up next card shows it. */
const upNextWordsOf = (next: MediaItem): string => {
  const { item } = next
  if (item === null || item.type !== ITEM_TYPES.episode) return mediaLabel(next)
  return [item.show?.title ?? null, episodeTag(item), item.title]
    .filter((part): part is string => part !== null && part !== '')
    .join(PLAYER_COPY.separator)
}

type Neighbours = {
  next: MediaItem | null
  previous: MediaItem | null
  /** What the Next button is called aloud for `next`. */
  nextLabel: (to: MediaItem) => string
}

type NeighboursOfProps = {
  isQueued: boolean
  queued: readonly MediaItem[]
  mediaId: number
  /** The next the server named, for a session it answers for. */
  serverNext: MediaItem | null
}

/**
 * What plays either side of this video: a library's shuffle walks the device's queue forward
 * and back, and every other session has only the next the server names.
 */
const neighboursOf = ({ isQueued, queued, mediaId, serverNext }: NeighboursOfProps): Neighbours => {
  if (!isQueued) return { next: serverNext, previous: null, nextLabel: nextLabelOf }
  return {
    next: queueNeighbourOf({ items: queued, mediaId, step: 1 }),
    previous: queueNeighbourOf({ items: queued, mediaId, step: -1 }),
    nextLabel: (to) => videoLabelOf({ word: PLAYER_COPY.nextVideo, media: to }),
  }
}

/** Whether this device's player resumes by a seek of ours once loaded; see `PLATFORM_TRAITS`. */
const IS_SEEKING_TO_RESUME = DEVICE_TRAITS.shouldSeekToResume

/** What the player saying it buffers, or not, tells the video state. */
const bufferEventOf = (isBuffering: boolean) =>
  isBuffering ? VIDEO_EVENTS.waiting : VIDEO_EVENTS.flowing

/** Keeps the screen on while it is drawn. */
const StayAwake = () => {
  useKeepAwake()
  return null
}

export type PlayingProps = {
  media: MediaItem
  /** How the video plays: its plan, its sources, its tracks, and whether a quality can be picked. */
  way: PlayWay
  summary: string | null
  at: number
  /** Starts at the very beginning, past any spot the server saved. */
  isFromStart: boolean
  session: AppQueries
  /** What the route says the viewer chose to watch; null for the video's own. */
  chosen: ViewingSession | null
  onBack: () => void
  /** Plays another video in this one's place. */
  onPlayNext: (next: MediaItem, viewing: ViewingSession) => void
}

/**
 * One video down its plan's ladder, under the platform's chrome: the session asks for each way's
 * source and steps down from the spot when one fails, the player's events drive the shared
 * video state, and that state drives the progress the server hears. An episode's next in its
 * show is on the chrome's Next, and plays by itself once this one ends while autoplay is on.
 */
export const Playing = ({
  media,
  way: { plan, sources, tracks, hasQuality },
  summary,
  at,
  isFromStart,
  session,
  chosen,
  onBack,
  onPlayNext,
}: PlayingProps) => {
  const queryClient = useQueryClient()
  const setWatching = useWatching((watching) => watching.setWatching)
  useEffect(() => {
    setWatching(true)
    return () => setWatching(false)
  }, [setWatching])
  const audioLanguage = usePlayerPrefs((prefs) => prefs.audioLanguage)
  const shouldAutoplay = usePlayerPrefs((prefs) => prefs.autoplay)
  // A show's episodes and a saga's films have a next; a video on its own asks nothing.
  const viewing = viewingOf({ chosen, itemType: media.item?.type ?? null })
  const next = useQuery({
    ...session.queries.nextInSessionQuery({ id: media.id, session: viewing }),
    enabled: asksServerForNext(viewing),
  })
  const queued = useVideoQueue((queue) => queue.items)
  const neighbours = neighboursOf({
    isQueued: viewing.kind === SESSION_KINDS.queue,
    queued,
    mediaId: media.id,
    serverNext: next.data ?? null,
  })
  const { next: nextMedia, previous: previousMedia } = neighbours
  // The end and a press of Next can both ask in one tick; the player leaves once.
  const hasLeft = useRef(false)
  const leaveFor = (to: MediaItem | null) => {
    if (to === null || hasLeft.current) return
    hasLeft.current = true
    onPlayNext(to, viewing)
  }
  const playNext = () => leaveFor(nextMedia)
  const subtitlePrefs = usePlayerPrefs((prefs) => prefs.subtitles)
  const setAudioLanguage = usePlayerPrefs((prefs) => prefs.setAudioLanguage)
  const setSubtitles = usePlayerPrefs((prefs) => prefs.setSubtitles)
  const [resumeAt] = useState(() => (isFromStart ? 0 : resumeAtFor({ at, media })))
  const heading = usePlayerHeading({ media, session })
  const [subtitle, setSubtitle] = useState(() =>
    preferredSubtitle({ tracks, isOn: subtitlePrefs.on, language: subtitlePrefs.language }),
  )
  // The same query the policy is read from, already answered: its height caps the sizes offered.
  const settings = useQuery(session.queries.playbackSettingsQuery)
  // The chapters come when they come; playback never waits on them, as on the web.
  const markers = useQuery(session.queries.markersQuery(media.id))
  const maxHeight = settings.data?.settings.maxHeight ?? DEFAULT_PLAYBACK_SETTINGS.maxHeight
  const [video, dispatchVideo] = useReducer(videoReducer, resumeAt, initialVideoState)
  const [isPaused, setPaused] = useState(false)
  const position = useRef(resumeAt)
  const [startState, dispatchStart] = useReducer(startReducer, NOT_LOADED)
  // Where the player draws the subtitles itself, the file's sidecars load beside it.
  const sidecarIds = useMemo(() => (shouldDrawCaptions ? [] : sidecarIdsOf(tracks)), [tracks])
  const { state, dispatch } = usePlaybackSession({
    media,
    modes: plan.modes,
    at: resumeAt,
    audio: preferredAudio({ tracks, language: audioLanguage }),
    problems: plan.problems,
    sources,
    sidecars: sidecarIds,
    /*
     * AVPlayer says it waits at the end of a file too, and the viewer's pause is no stall; a
     * video still held for its resume seek is not stalled either.
     */
    isWaiting: video.waiting && !isPaused && !video.ended && !isHeldOf(startState),
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
  const burning = ladder?.burn ?? null
  const captions = captionsFor({
    mode,
    tracks,
    subtitle,
    isBurning: burning !== null,
    shouldDrawCaptions,
    canDrawPictureSubtitles,
  })
  const { style: captionStyle } = useCaptionStyle(session.api)
  const { cues } = useTrackCues({
    video: {
      api: session.api,
      mediaId: media.id,
      readAccess: () => sources.subtitleAccess(media.id),
    },
    track: captions.cueTrack,
    time: video.time,
    duration,
  })
  const showing = activeCues({ cues, time: video.time })
  const startAt = ladder?.at ?? resumeAt
  const attempt = ladder?.attempt ?? null
  const isStarted = !IS_SEEKING_TO_RESUME || isStartedOf({ state: startState, attempt })
  // Read by the player's events, which may come to a handler from an earlier render.
  const hasStarted = useRef(isStarted)
  useEffect(() => {
    hasStarted.current = isStarted
  }, [isStarted])
  useSeekGrace({
    state: startState,
    onLanded: (landed) => dispatchStart({ type: START_EVENTS.landed, attempt: landed }),
  })

  // The session hands out a new source for each attempt, which the player loads from its spot.
  const source = useMemo(
    () =>
      sourced === null
        ? null
        : {
            uri: sourced.source.uri,
            headers: sourced.source.headers,
            bufferConfig: PLAYER_BUFFER,
            // Only a file played as it is comes with sidecars: a stream has its renditions.
            ...(sourced.sidecars.length > 0
              ? { textTracks: sidecarTracksOf({ sidecars: sourced.sidecars, tracks }) }
              : {}),
            ...(IS_SEEKING_TO_RESUME ? {} : { startPosition: startAt * 1000 }),
          },
    [sourced, tracks, startAt],
  )

  /*
   * ExoPlayer may play the original without the audio asked for, saying nothing: once the pick
   * has settled, a play with a way left below steps down when it did.
   */
  const heardAudio = useRef<HeardAudio | null>(null)
  const hear = (hearing: AudioHearing) => {
    const canJudge = state.phase === SESSION_PHASES.playing && hasWayBelow(state)
    const { heard, toJudge } = hearAudio({ heard: heardAudio.current, hearing, canJudge })
    heardAudio.current = heard
    if (toJudge === null) return
    if (isAudioDropped({ platform: DEVICE_PLATFORM, mode, place: audioPlace, reported: toJudge })) {
      dispatch({ type: SESSION_EVENTS.failed, attempt: hearing.attempt, at: position.current })
    }
  }

  /*
   * AVPlayer may play a file's sound without its picture, saying nothing (HEVC under `hev1`): a
   * direct play with a way left below steps down once its clock has run with nothing drawn.
   */
  const watchedPicture = useRef<PictureWatch | null>(null)
  const seePicture = (hearing: PictureHearing) => {
    const { watch, isMissing } = watchPicture({
      watch: watchedPicture.current,
      hearing,
      platform: DEVICE_PLATFORM,
      mode,
    })
    watchedPicture.current = watch
    if (!isMissing || state.phase !== SESSION_PHASES.playing || !hasWayBelow(state)) return
    dispatch({ type: SESSION_EVENTS.failed, attempt: hearing.attempt, at: position.current })
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

  const pickAudio = (key: string) => {
    const track = tracks?.audio.find((each) => String(each.index) === key) ?? null
    if (track === null) return
    setAudioLanguage(track.language)
    dispatch({ type: SESSION_EVENTS.audioPicked, audio: track.index, at: position.current })
  }

  /*
   * The player draws a picture track itself only from the file it plays; anywhere else the
   * server burns it into a transcode.
   */
  const canDrawPictures = canDrawPictureSubtitles && mode === PLAYBACK_MODES.direct
  const pickSubtitle = (key: string) => {
    const id = key === SUBTITLE_CHOICES.off ? null : key
    const track = tracks?.subtitles.find((each) => each.id === id) ?? null
    setSubtitles({ on: id !== null, language: track?.language ?? subtitlePrefs.language })
    setSubtitle(id)
    const burn = track !== null && isPictureSubtitle(track) && !canDrawPictures ? track.id : null
    if (burn !== burning) {
      dispatch({ type: SESSION_EVENTS.burnPicked, burn, at: position.current })
    }
  }

  /*
   * Direct play plays the file itself, whatever the plan started with. A size moves the play to
   * the transcode, where only a burn shows a picture track ExoPlayer drew.
   */
  const pickQuality = (key: string) => {
    const quality = pickedQualityOf(key)
    if (quality === null) {
      dispatch({ type: SESSION_EVENTS.directPicked, at: position.current })
      return
    }
    const track = tracks?.subtitles.find((each) => each.id === subtitle) ?? null
    const burn = burning ?? (track !== null && isPictureSubtitle(track) ? track.id : null)
    dispatch({ type: SESSION_EVENTS.qualityPicked, quality, burn, at: position.current })
  }
  const qualityOptions =
    ladder === null ? [] : qualityOptionsOf({ media, modes: ladder.modes, maxHeight })

  const subtitleOptions =
    tracks === null
      ? []
      : subtitleOptionsOf({
          tracks,
          pictures: picturesFor({
            canDraw: canDrawPictures,
            canBurn: ladder?.modes.includes(PLAYBACK_MODES.transcode) ?? false,
          }),
        })
  const audioValue = audioPlaying === null ? '' : String(audioPlaying)
  const audioTrack: VideoSurface['selectedAudioTrack'] =
    audioPlace === null ? undefined : { type: SelectedTrackType.INDEX, value: audioPlace }
  const surface: VideoSurface | null =
    source === null || attempt === null
      ? null
      : {
          ref: player,
          onBuffer: ({ isBuffering }) => dispatchVideo({ type: bufferEventOf(isBuffering) }),
          onEnd: () => {
            setPaused(true)
            dispatchVideo({ type: VIDEO_EVENTS.ended })
            if (shouldAutoplay) playNext()
          },
          /*
           * The server letting go of the source (a ticket past its life, an HLS session it ended)
           * opens the same way again from the spot; any other failure steps down the ladder.
           */
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
            if (!IS_SEEKING_TO_RESUME) return
            dispatchStart({ type: START_EVENTS.loaded, attempt, at: startAt })
            const current = player.current
            if (startAt > 0 && current !== null) current.seek(startAt)
          },
          onSeek: () => dispatchStart({ type: START_EVENTS.landed, attempt }),
          /*
           * AVPlayer says its buffer ran full only after it ran empty, which a fast stream never
           * does, so playing is also what says frames flow; without it the play never starts.
           */
          onPlaybackStateChanged: ({ isPlaying }) => {
            dispatchVideo({ type: isPlaying ? VIDEO_EVENTS.played : VIDEO_EVENTS.paused })
            if (isPlaying) dispatchVideo({ type: VIDEO_EVENTS.flowing })
          },
          onProgress: ({ currentTime }) => {
            // Before the resume seek lands the player says 0:00, which is not where the viewer is.
            if (!hasStarted.current) return
            position.current = currentTime
            dispatchVideo({ type: VIDEO_EVENTS.moved, time: currentTime, buffered: [] })
            hear({ type: AUDIO_HEARINGS.moved, attempt, clock: currentTime })
            seePicture({ type: PICTURE_HEARINGS.moved, attempt, clock: currentTime })
          },
          onReadyForDisplay: () => seePicture({ type: PICTURE_HEARINGS.drawn, attempt }),
          paused: isPaused || !isStarted,
          progressUpdateInterval: PROGRESS_EVERY_MS,
          selectedAudioTrack: audioTrack,
          selectedTextTrack: captions.textTrack,
          subtitleStyle: shouldDrawCaptions ? undefined : playerSubtitleStyleOf(captionStyle),
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
        captionStyle={captionStyle}
        audio={
          tracks === null || tracks.audio.length < 2 || ladder === null
            ? null
            : {
                options: audioOptionsOf(tracks),
                value: audioValue,
                onChoose: pickAudio,
              }
        }
        mode={mode}
        chapters={markers.data?.chapters ?? NO_CHAPTERS}
        credits={markers.data?.credits ?? null}
        next={
          nextMedia === null
            ? null
            : {
                label: neighbours.nextLabel(nextMedia),
                words: upNextWordsOf(nextMedia),
                onPlay: playNext,
              }
        }
        previous={
          previousMedia === null
            ? null
            : {
                label: videoLabelOf({ word: PLAYER_COPY.previousVideo, media: previousMedia }),
                onPlay: () => leaveFor(previousMedia),
              }
        }
        quality={
          ladder === null || !hasQuality
            ? null
            : {
                options: qualityOptions,
                value: qualityKeyOf({ mode, quality: ladder.quality }),
                onChoose: pickQuality,
              }
        }
        isOpening={isOpeningOf(state)}
        notice={noticeOf(state)}
        onBack={onBack}
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
        heading={heading}
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
