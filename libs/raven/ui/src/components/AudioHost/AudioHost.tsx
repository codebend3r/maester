import { type ApiClient, type Track, artistNames, isFlatEq, levelOf } from '@raven/core'
import { useQuery } from '@tanstack/react-query'
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { failureMessage } from '@/components/Player/useMediaSource'
import { useMediaPlane } from '@/components/Player/useMediaPlane'
import { useVideoEvents } from '@/components/Player/useVideoEvents'
import { useListenCounter } from '@/components/AudioHost/useListenCounter'
import { startOf, useAudiobookSpot } from '@/components/AudioHost/useAudiobookSpot'
import {
  type Crossfade,
  type ElementLoads,
  useCrossfade,
} from '@/components/AudioHost/useCrossfade'
import { hasWebAudio, useSoundGraph } from '@/components/AudioHost/useSoundGraph'
import { watchPageHide } from '@/components/Player/watchPageHide'
import { useIsAudiobook, useTrackBitrate, useTrackRate } from '@/query/useAudiobook'
import { ravenQueriesFor } from '@/query/ravenQueries'
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

/** What the elements ask for when their sound goes through Web Audio, which reads only CORS media. */
const CROSS_ORIGIN = 'anonymous'

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

type ElementRef = RefObject<HTMLAudioElement | null>

type UseTrackSourceProps = {
  api: ApiClient
  track: Track | null
  reprobe: () => void
}

/**
 * The address a track plays from, as a video's: through the web host's own
 * address, or from the picked media origin once a ticket for the track has
 * come. It plays from its file, or from the transcode at `useTrackBitrate`'s
 * bitrate. Null while there is no track, while the ticket is on its way,
 * and while the libraries that pick between the two are, as the element never
 * reloads mid-track; once they have failed it plays from its file.
 */
const useTrackSource = ({ api, track, reprobe }: UseTrackSourceProps): string | null => {
  const pick = useMediaOrigin((state) => state.pick)
  const queries = useMemo(() => ravenQueriesFor(api), [api])
  const libraries = useQuery({ ...queries.librariesQuery, enabled: track !== null })
  const kbps = useTrackBitrate({ api, track })
  const plane = useMediaPlane({
    api,
    mediaId: track?.id ?? 0,
    reprobe,
    isEnabled: track !== null,
  })
  if (track === null || libraries.isPending) return null
  if (pick !== null && plane.access === null) return null
  if (kbps === null) return api.fileUrl({ id: track.id, access: plane.access })
  return api.transcodeUrl({ mediaId: track.id, kbps, access: plane.access })
}

type UseLevelledVolumeProps = {
  ref: ElementRef
  /** The track the element holds; null for none. */
  track: Track | null
}

/** Sets an element's volume to the prefs' times its track's levelling factor. */
const useLevelledVolume = ({ ref, track }: UseLevelledVolumeProps) => {
  const volume = usePlayerPrefs((prefs) => prefs.volume)
  const isMuted = usePlayerPrefs((prefs) => prefs.muted)
  const levelling = usePlayerPrefs((prefs) => prefs.levelling)
  const level = track === null ? 1 : levelOf({ track, mode: levelling })
  useEffect(() => {
    const element = ref.current
    if (!element) return
    element.volume = volume * level
    element.muted = isMuted
  }, [ref, volume, level, isMuted])
}

type UsePreloadProps = {
  ref: ElementRef
  id: number | null
  src: string | null
  /** Whether the load asks for CORS, as Web Audio needs. */
  isCors: boolean
  loads: RefObject<ElementLoads>
}

/** Loads the next track into the element that does not lead, so the swap at the end is near gapless, or a fade can start it. */
const usePreload = ({ ref, id, src, isCors, loads }: UsePreloadProps) => {
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const loaded = loads.current.get(element)
    if (id === null) {
      if (!loaded) return
      loads.current.delete(element)
      element.removeAttribute('src')
      element.load()
      return
    }
    if (src === null || (loaded?.id === id && loaded.isCors === isCors)) return
    loads.current.set(element, { id, isCors })
    element.src = src
    element.load()
  }, [ref, id, src, isCors, loads])
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
  /** The element that leads: the one playing the queue's track. */
  ref: ElementRef
  /** Both elements, whose events are heard while each leads. */
  elements: readonly [ElementRef, ElementRef]
  /** The playing track's id; null for none. */
  id: number | null
  /** The playing track's address; null for none, and while its ticket is on its way. */
  src: string | null
  /** Where the track starts: an audiobook's saved spot, else 0; null while that is being read. */
  start: number | null
  /** How fast it plays: an audiobook's chosen speed, else 1. */
  rate: number
  /** Whether the load asks for CORS, as Web Audio needs. */
  isCors: boolean
  loads: RefObject<ElementLoads>
  play: (element: HTMLMediaElement) => void
  crossfade: Crossfade
}

/**
 * Drives the leading `<audio>` element from the queue store, and reports
 * what it does back. The source is attached once per track: a renewed
 * ticket makes a new address, which the playing element need not take, as
 * the ticket that opened its file keeps opening it, and it starts at
 * `start`, waiting for it. A track loaded before its sound went through Web
 * Audio loads again with CORS, from where it was. Play and pause follow the
 * store, and the speed `rate` says.
 */
const useAudioElement = ({
  ref,
  elements,
  id,
  src,
  start,
  rate,
  isCors,
  loads,
  play,
  crossfade,
}: UseAudioElementProps) => {
  const shouldPlay = useAudioQueue((store) => store.shouldPlay)
  const seek = useAudioQueue((store) => store.seek)
  const engine = useAudioQueue((store) => store.engine)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    const loaded = loads.current.get(element)
    if (id === null) {
      loads.current.delete(element)
      element.pause()
      element.removeAttribute('src')
      element.load()
      return
    }
    if (src === null || start === null) return
    if (loaded?.id !== id || loaded.isCors !== isCors) {
      const isSameTrack = loaded?.id === id
      const from = isSameTrack ? element.currentTime : start
      loads.current.set(element, { id, isCors })
      element.src = src
      element.load()
      // Set before the file is read, it is where the element starts once it is.
      if (from > 0) {
        element.currentTime = from
        if (!isSameTrack) engine.time({ position: from, duration: null })
      }
    }
    if (shouldPlay) {
      play(element)
      return
    }
    element.pause()
  }, [ref, id, src, start, shouldPlay, isCors, loads, play, engine])

  useEffect(() => {
    const element = ref.current
    if (!element || seek === null) return
    element.currentTime = seek.seconds
    // A track asked to start over after it ended plays again only when told to.
    if (shouldPlay && element.ended) play(element)
    engine.sought()
  }, [ref, seek, engine, shouldPlay, play])

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
  /** Hears `listen` from the leading element only: the other one preloads, or fades in. */
  const fromLead =
    (listen: (element: HTMLAudioElement) => void) =>
    (element: HTMLAudioElement): void => {
      if (element === ref.current) listen(element)
    }
  const on = {
    playing: fromLead(() => engine.state(AUDIO_STATES.playing)),
    pause: fromLead((element) => {
      if (id !== null && !element.ended) engine.state(AUDIO_STATES.paused)
    }),
    waiting: fromLead(() => engine.state(AUDIO_STATES.loading)),
    timeupdate: fromLead((element) => {
      report(element)
      crossfade.startIfDue(element)
    }),
    durationchange: fromLead(report),
    ended: fromLead(() => engine.ended()),
    error: fromLead((element) => engine.failed(failureMessage(element.error))),
  }
  const [first, second] = elements
  useVideoEvents({ videoRef: first, on })
  useVideoEvents({ videoRef: second, on })
}

type AudioHostProps = {
  api: ApiClient
  /** Asks the media origins to be probed again when the picked one cannot be reached. */
  reprobe: () => void
}

/**
 * Whether the elements' sound goes through Web Audio: from the first time
 * the equalizer or a crossfade needs it, for as long as the host lives, as
 * an element once routed cannot be taken back out. Until then nothing is
 * routed and no context is made, so the elements play as plain `<audio>`
 * and fetch without CORS.
 */
const useIsRouted = (): boolean => {
  const gains = usePlayerPrefs((prefs) => prefs.equalizer.gains)
  const crossfade = usePlayerPrefs((prefs) => prefs.crossfade)
  const [isRouted, setRouted] = useState(false)
  if (!isRouted && hasWebAudio() && (crossfade > 0 || !isFlatEq(gains))) setRouted(true)
  return isRouted
}

/**
 * The web's audio engine: two `<audio>` elements, one playing the queue's
 * track and the other preloading the next, mounted once by the page's player
 * layer, over every shell, so playback carries on from page to page and from
 * mode to mode. Tracks play
 * through the web host or the picked media origin, as videos do. Each
 * element's volume is levelled by its track's gain. With the equalizer on or
 * a crossfade set, both play through one Web Audio graph, and a crossfade
 * starts the preloaded element under the end of the playing one, which hands
 * it the lead; with neither, the playing element takes the next track itself
 * at the end. It tells the media session what plays and counts a listen at
 * half the track or four minutes. An audiobook plays at the speed the prefs
 * hold, starts where it was left and saves its spot as it plays, and never
 * crossfades, in or out; music saves none. The chrome (the bar, Now Playing, the queue
 * page) reads and drives the store, never this.
 */
export const AudioHost = ({ api, reprobe }: AudioHostProps) => {
  const first = useRef<HTMLAudioElement>(null)
  const second = useRef<HTMLAudioElement>(null)
  const elements = useMemo(() => [first, second] as const, [])
  const loads = useRef<ElementLoads>(new WeakMap())
  const track = useAudioQueue(playingTrackOf)
  const upNext = useAudioQueue(nextTrackOf)
  const src = useTrackSource({ api, track, reprobe })
  const preload = useTrackSource({ api, track: upNext, reprobe })
  const rate = useTrackRate({ api, track })
  const isAudiobook = useIsAudiobook({ api, track })
  const isNextAudiobook = useIsAudiobook({ api, track: upNext })
  const start = startOf(useAudiobookSpot({ api, track, watchHide: watchPageHide }))
  const isRouted = useIsRouted()
  const gains = usePlayerPrefs((prefs) => prefs.equalizer.gains)
  const seconds = usePlayerPrefs((prefs) => prefs.crossfade)
  const route = useSoundGraph({ elements, isRouted, gains })
  const { wake } = route
  const play = useCallback(
    (element: HTMLMediaElement) => {
      wake()
      playQuietly(element)
    },
    [wake],
  )
  const crossfade = useCrossfade({
    elements,
    trackId: track?.id ?? null,
    nextId: upNext?.id ?? null,
    seconds: isAudiobook || isNextAudiobook ? 0 : seconds,
    graph: route.graph,
    loads,
    play,
  })
  const lead = elements[crossfade.lead] ?? first
  const other = lead === first ? second : first
  useAudioElement({
    ref: lead,
    elements,
    id: track?.id ?? null,
    src,
    start,
    rate,
    isCors: isRouted,
    loads,
    play,
    crossfade,
  })
  usePreload({ ref: other, id: upNext?.id ?? null, src: preload, isCors: isRouted, loads })
  useLevelledVolume({ ref: lead, track })
  useLevelledVolume({ ref: other, track: upNext })
  useMediaSession({ api, track, rate })
  useListenCounter({ api, track })
  const crossOrigin = isRouted ? CROSS_ORIGIN : undefined
  return (
    <div className={styles.host} aria-hidden="true">
      {/* Music has no captions to offer; Now Playing shows the lyrics. */}
      {/* oxlint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={first} preload="auto" crossOrigin={crossOrigin} />
      {/* oxlint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={second} preload="auto" crossOrigin={crossOrigin} />
    </div>
  )
}
