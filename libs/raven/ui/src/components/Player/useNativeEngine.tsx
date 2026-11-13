import {
  type ApiClient,
  type MediaTracks,
  PLAYER_COMMANDS,
  PLAYER_EVENTS,
  type PlayerEvent,
  type PlayerSource,
} from '@raven/core'
import { useEffect, useEffectEvent, useReducer, useRef, useState } from 'react'
import { NATIVE_ENGINE_COPY } from '@/components/Player/copy'
import {
  type EngineHandle,
  type NativePlayer,
  SURFACE_MARK,
  sendQuietly,
} from '@/components/Player/engine'
import { fromPlayerEvent, rangesFrom } from '@/components/Player/fromPlayerEvent'
import styles from '@/components/Player/Player.module.scss'
import { useHostServices } from '@/stores/playerServices'
import { useNativeTrackSelection } from '@/components/Player/useNativeTrackSelection'
import {
  type Ranges,
  VIDEO_EVENTS,
  initialVideoState,
  videoReducer,
} from '@/components/Player/videoState'
import { SUBTITLE_STATUSES } from '@/lib/useTrackCues'
import { usePlayerPrefs } from '@/stores/playerPrefs'
import { useCaptionStyle } from '@/query/useCaptionStyle'

/** Where a seek stops short of the end, so the player never seeks past its last frame. */
const END_MARGIN_SECONDS = 0.5

const messageOf = (error: unknown): string =>
  error instanceof Error && error.message !== '' ? error.message : NATIVE_ENGINE_COPY.couldNotOpen

type PlayerErrorEvent = Extract<PlayerEvent, { type: typeof PLAYER_EVENTS.error }>

type UseNativeEngineProps = {
  player: NativePlayer
  source: PlayerSource
  /** The server whose account's subtitle look the player draws; null for a plain local file. */
  api: ApiClient | null
  onFailure: (message: string) => void
  toggleFullscreen: () => void
}

/**
 * The engine for a player in another process: it loads the source, folds the
 * player's events into the same state the html engine keeps from its
 * element, and sends the controls' actions as commands. One mount plays one
 * source: the caller keys it by `sourceKey`, so a different video starts from
 * fresh state.
 */
export const useNativeEngine = ({
  player,
  source,
  api,
  onFailure,
  toggleFullscreen,
}: UseNativeEngineProps): EngineHandle => {
  const title = useHostServices((services) => services.title)
  const trackPicks = useHostServices((services) => services.trackPicks)
  const isVolumeFixed = useHostServices((services) => services.isVolumeFixed)
  const onEngineError = useHostServices((services) => services.onEngineError)
  const setVolume = usePlayerPrefs((prefs) => prefs.setVolume)
  const captions = useCaptionStyle(api)
  // Whether main answered this mount's load, after which it takes the subtitle look.
  const [hasLoaded, setHasLoaded] = useState(false)
  const [state, dispatch] = useReducer(videoReducer, title.resumeAt, initialVideoState)
  const [tracks, setTracks] = useState<MediaTracks | null>(null)
  const position = useRef(title.resumeAt)
  const buffered = useRef<Ranges>([])
  const duration = title.duration ?? state.elementDuration
  const selection = useNativeTrackSelection({ tracks, player })

  const fail = useEffectEvent(onFailure)
  const tellHost = useEffectEvent(({ reason, message }: PlayerErrorEvent) => {
    if (onEngineError === null) return
    onEngineError({ reason, message })
  })
  const current = useEffectEvent(() => ({
    source,
    resumeAt: title.resumeAt,
    picks: trackPicks?.start ?? null,
    isFixed: isVolumeFixed,
  }))
  const { size, colour } = captions.style
  useEffect(() => {
    // The port is ordered, so what arrives after the answer belongs to this load.
    let isLoaded = false
    let isCurrent = true
    const { source: loading, resumeAt, picks, isFixed } = current()
    const unsubscribe = player.subscribe((event) => {
      if (!isLoaded) return
      switch (event.type) {
        case PLAYER_EVENTS.tracks:
          setTracks(event.tracks)
          return
        case PLAYER_EVENTS.error:
          // Unplayable first, so a host callback that throws cannot keep it away.
          fail(event.message === '' ? NATIVE_ENGINE_COPY.couldNotPlay : event.message)
          tellHost(event)
          return
        case PLAYER_EVENTS.time:
          position.current = event.time
          break
        case PLAYER_EVENTS.buffered:
          buffered.current = rangesFrom(event.ranges)
          break
        default:
          break
      }
      const folded = fromPlayerEvent({ event, buffered: buffered.current })
      if (folded) dispatch(folded)
    })
    player
      .send({
        type: PLAYER_COMMANDS.load,
        source: loading,
        start: resumeAt,
        audio: picks?.audio ?? null,
        subtitle: picks?.subtitle ?? null,
      })
      .then(
        () => {
          if (!isCurrent) return
          isLoaded = true
          setHasLoaded(true)
          const prefs = usePlayerPrefs.getState()
          if (!isFixed) {
            sendQuietly({
              player,
              command: { type: PLAYER_COMMANDS.volume, volume: prefs.volume, muted: prefs.muted },
            })
          }
        },
        (error: unknown) => {
          if (isCurrent) fail(messageOf(error))
        },
      )
    return () => {
      isCurrent = false
      setHasLoaded(false)
      unsubscribe()
      sendQuietly({ player, command: { type: PLAYER_COMMANDS.stop } })
    }
  }, [player])

  // The account's look, sent once the load is answered and again whenever it changes.
  useEffect(() => {
    if (!hasLoaded) return
    sendQuietly({
      player,
      command: { type: PLAYER_COMMANDS.subtitleStyle, style: { size, colour } },
    })
  }, [player, hasLoaded, size, colour])

  const actions: EngineHandle['actions'] = {
    play: () => sendQuietly({ player, command: { type: PLAYER_COMMANDS.play } }),
    pause: () => sendQuietly({ player, command: { type: PLAYER_COMMANDS.pause } }),
    seek: (target) => {
      const to = Math.min(
        Math.max(0, (duration ?? Infinity) - END_MARGIN_SECONDS),
        Math.max(0, target),
      )
      position.current = to
      dispatch({ type: VIDEO_EVENTS.sought, time: to })
      sendQuietly({ player, command: { type: PLAYER_COMMANDS.seek, time: to } })
    },
    setVolume: (level) => {
      sendQuietly({ player, command: { type: PLAYER_COMMANDS.volume, ...level } })
      setVolume(level)
    },
    setRate: (rate) => sendQuietly({ player, command: { type: PLAYER_COMMANDS.speed, rate } }),
    setAudio: selection.pickAudio,
    setSubtitle: selection.pickSubtitle,
    setCaptionStyle: captions.change,
    toggleStats: () => sendQuietly({ player, command: { type: PLAYER_COMMANDS.stats } }),
  }

  const engine: EngineHandle = {
    state,
    duration,
    position,
    tracks,
    captionStyle: captions.style,
    actions,
    selection,
    // mpv draws the subtitles itself, so they are ready as soon as one is picked.
    subtitles: {
      status: selection.subtitle ? SUBTITLE_STATUSES.ready : SUBTITLE_STATUSES.off,
      overlay: null,
    },
    // The picture's figures stay in mpv; its own overlay (`i`) shows them.
    readStats: () => ({
      engine: NATIVE_ENGINE_COPY.engineName,
      viewport: null,
      frame: null,
      frames: null,
    }),
    focusSurface: () => {},
    surface: (
      // The window-wide shortcuts are the keyboard path, so the surface takes only the pointer.
      // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
      <div
        {...SURFACE_MARK}
        className={styles.nativeSurface}
        onClick={() => (state.paused ? actions.play() : actions.pause())}
        onDoubleClick={toggleFullscreen}
      />
    ),
  }
  return engine
}
