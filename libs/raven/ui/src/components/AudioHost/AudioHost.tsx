import { type ApiClient, type Track, artistNames } from '@raven/core'
import { type RefObject, useEffect, useRef } from 'react'
import { failureMessage } from '@/components/Player/useMediaSource'
import { useMediaPlane } from '@/components/Player/useMediaPlane'
import { useVideoEvents } from '@/components/Player/useVideoEvents'
import { useListenCounter } from '@/components/AudioHost/useListenCounter'
import { startOf, useAudiobookSpot } from '@/components/AudioHost/useAudiobookSpot'
import { watchPageHide } from '@/components/Player/watchPageHide'
import { useTrackRate } from '@/query/useAudiobook'
import {
  AUDIO_STATES,
  type AudioState,
  nextTrackOf,
  playingTrackOf,
  useAudioQueue,
} from '@/stores/audioQueue'
import { useMediaOrigin } from '@/stores/mediaOrigin'
import { usePlayerPrefs } from '@/stores/playerPrefs'
import styles from '@/components/AudioHost/AudioHost.module.scss'

/** Plays, and lets a refused play go: the browser says why in its own events. */
const playQuietly = (element: HTMLMediaElement): void => {
  ;(element.play() ?? Promise.resolve()).catch(() => undefined)
}

/** What the browser's media session is told for each state; `none` while nothing is loaded. */
const SESSION_STATES = {
  empty: 'none',
  loading: 'playing',
  playing: 'playing',
  paused: 'paused',
  failed: 'none',
} as const satisfies Record<AudioState, MediaSessionPlaybackState>

type UseTrackSourceProps = {
  api: ApiClient
  track: Track | null
  reprobe: () => void
}

/**
 * The address a track plays from, as a video's: through the web host's own
 * address, or from the picked media origin once a ticket for the track has
 * come. Null while there is no track, or the ticket is on its way.
 */
const useTrackSource = ({ api, track, reprobe }: UseTrackSourceProps): string | null => {
  const pick = useMediaOrigin((state) => state.pick)
  const plane = useMediaPlane({
    api,
    mediaId: track?.id ?? 0,
    reprobe,
    isEnabled: track !== null,
  })
  if (track === null) return null
  if (pick !== null && plane.access === null) return null
  return api.fileUrl({ id: track.id, access: plane.access })
}

type UseMediaSessionProps = {
  api: ApiClient
  track: Track | null
  /** How fast the track plays, so the lock screen's clock runs with it. */
  rate: number
}

/** Tells the browser's media session what plays, so the lock screen and the media keys show and drive it. */
const useMediaSession = ({ api, track, rate }: UseMediaSessionProps) => {
  const state = useAudioQueue((store) => store.state)
  const position = useAudioQueue((store) => store.position)
  const duration = useAudioQueue((store) => store.duration)
  const play = useAudioQueue((store) => store.play)
  const pause = useAudioQueue((store) => store.pause)
  const skipNext = useAudioQueue((store) => store.next)
  const skipPrevious = useAudioQueue((store) => store.previous)
  const seekTo = useAudioQueue((store) => store.seekTo)
  useEffect(() => {
    const session = navigator.mediaSession
    if (!session) return
    if (track === null) {
      session.metadata = null
      return
    }
    const cover = api.albumCoverUrl({
      albumId: track.albumId,
      coverVersion: track.album.coverVersion,
    })
    session.metadata = new MediaMetadata({
      title: track.title,
      artist: artistNames(track),
      album: track.album.title,
      artwork: cover === null ? [] : [{ src: cover }],
    })
  }, [api, track])
  useEffect(() => {
    const session = navigator.mediaSession
    if (!session) return
    session.setActionHandler('play', () => play())
    session.setActionHandler('pause', () => pause())
    session.setActionHandler('nexttrack', () => skipNext())
    session.setActionHandler('previoustrack', () => skipPrevious())
    session.setActionHandler('seekto', (details) => {
      if (details.seekTime !== undefined) seekTo(details.seekTime)
    })
    return () => {
      session.setActionHandler('play', null)
      session.setActionHandler('pause', null)
      session.setActionHandler('nexttrack', null)
      session.setActionHandler('previoustrack', null)
      session.setActionHandler('seekto', null)
    }
  }, [play, pause, skipNext, skipPrevious, seekTo])
  useEffect(() => {
    const session = navigator.mediaSession
    if (!session) return
    session.playbackState = SESSION_STATES[state]
    if (duration !== null && Number.isFinite(duration) && position <= duration) {
      session.setPositionState({ duration, position, playbackRate: rate })
    }
  }, [state, position, duration, rate])
}

type UseAudioElementProps = {
  ref: RefObject<HTMLAudioElement | null>
  /** The playing track's id; null for none. */
  id: number | null
  /** The playing track's address; null for none, and while its ticket is on its way. */
  src: string | null
  /** Where the track starts: an audiobook's saved spot, else 0; null while that is being read. */
  start: number | null
  /** How fast it plays: an audiobook's chosen speed, else 1. */
  rate: number
}

/**
 * Drives the `<audio>` element from the queue store, and reports what it
 * does back. The source is attached once per track: a renewed ticket makes
 * a new address, which the playing element need not take, as the ticket
 * that opened its file keeps opening it, and it starts at `start`, waiting
 * for it. Play and pause follow the store, and the speed `rate` says.
 */
const useAudioElement = ({ ref, id, src, start, rate }: UseAudioElementProps) => {
  const shouldPlay = useAudioQueue((store) => store.shouldPlay)
  const seek = useAudioQueue((store) => store.seek)
  const engine = useAudioQueue((store) => store.engine)
  const volume = usePlayerPrefs((prefs) => prefs.volume)
  const isMuted = usePlayerPrefs((prefs) => prefs.muted)
  const loaded = useRef<number | null>(null)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    if (id === null) {
      loaded.current = null
      element.removeAttribute('src')
      element.load()
      return
    }
    if (src === null || start === null) return
    if (loaded.current !== id) {
      loaded.current = id
      element.src = src
      element.load()
      // Set before the file is read, it is where the element starts once it is.
      if (start > 0) {
        element.currentTime = start
        engine.time({ position: start, duration: null })
      }
    }
    if (shouldPlay) {
      playQuietly(element)
      return
    }
    element.pause()
  }, [ref, id, src, start, shouldPlay, engine])

  useEffect(() => {
    const element = ref.current
    if (!element || seek === null) return
    element.currentTime = seek.seconds
    // A track asked to start over after it ended plays again only when told to.
    if (shouldPlay && element.ended) playQuietly(element)
    engine.sought()
  }, [ref, seek, engine, shouldPlay])

  useEffect(() => {
    const element = ref.current
    if (!element) return
    element.volume = volume
    element.muted = isMuted
  }, [ref, volume, isMuted])

  // The default too, which a new track's load puts the speed back to.
  useEffect(() => {
    const element = ref.current
    if (!element) return
    element.defaultPlaybackRate = rate
    element.playbackRate = rate
  }, [ref, rate])

  const report = (element: HTMLMediaElement) =>
    engine.time({
      position: element.currentTime,
      duration: Number.isFinite(element.duration) ? element.duration : null,
    })
  useVideoEvents({
    videoRef: ref,
    on: {
      playing: () => engine.state(AUDIO_STATES.playing),
      pause: (element) => {
        if (!element.ended) engine.state(AUDIO_STATES.paused)
      },
      waiting: () => engine.state(AUDIO_STATES.loading),
      timeupdate: report,
      durationchange: report,
      ended: () => engine.ended(),
      error: (element) => engine.failed(failureMessage(element.error)),
    },
  })
}

type AudioHostProps = {
  api: ApiClient
  /** Asks the media origins to be probed again when the picked one cannot be reached. */
  reprobe: () => void
}

/**
 * The web's audio engine: one `<audio>` element playing the queue's track
 * and a second preloading the next, mounted once at the app shell, outside
 * the router, so playback carries on from page to page. Tracks play
 * through the web host or the picked media origin, as videos do. It tells
 * the media session what plays and counts a listen at half the track or
 * four minutes. An audiobook plays at the speed the prefs hold, starts where
 * it was left and saves its spot as it plays; music saves none. The chrome
 * (the bar, Now Playing, the queue page) reads and drives the store, never this.
 */
export const AudioHost = ({ api, reprobe }: AudioHostProps) => {
  const ref = useRef<HTMLAudioElement>(null)
  const track = useAudioQueue(playingTrackOf)
  const upNext = useAudioQueue(nextTrackOf)
  const src = useTrackSource({ api, track, reprobe })
  const preload = useTrackSource({ api, track: upNext, reprobe })
  const rate = useTrackRate({ api, track })
  const start = startOf(useAudiobookSpot({ api, track, watchHide: watchPageHide }))
  useAudioElement({ ref, id: track?.id ?? null, src, start, rate })
  useMediaSession({ api, track, rate })
  useListenCounter({ api, track })
  return (
    <div className={styles.host} aria-hidden="true">
      {/* Music has no captions to offer; Now Playing shows the lyrics. */}
      {/* oxlint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={ref} preload="auto" />
      {/* The next track fetches ahead, so the swap at the end is near gapless. */}
      {/* oxlint-disable-next-line jsx-a11y/media-has-caption */}
      {preload !== null && <audio preload="auto" src={preload} />}
    </div>
  )
}
