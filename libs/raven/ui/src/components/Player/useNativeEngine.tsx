import { type MediaTracks, PLAYER_EVENTS, type PlayerEvent, type PlayerSource } from '@raven/core'
import { useEffect, useEffectEvent, useReducer, useRef, useState } from 'react'
import { type EngineHandle, type NativePlayer, sendQuietly } from '@/components/Player/engine'
import { fromPlayerEvent, rangesFrom } from '@/components/Player/fromPlayerEvent'
import styles from '@/components/Player/Player.module.scss'
import { useHostServices } from '@/stores/playerServices'
import { useNativeTrackSelection } from '@/components/Player/useNativeTrackSelection'
import { type Ranges, initialVideoState, videoReducer } from '@/components/Player/videoState'
import { usePlayerPrefs } from '@/stores/playerPrefs'

const ENGINE_NAME = 'mpv'
const COULD_NOT_OPEN = 'raven player could not open this video.'
const COULD_NOT_PLAY = 'raven player could not play this video.'

const messageOf = (error: unknown): string =>
  error instanceof Error && error.message !== '' ? error.message : COULD_NOT_OPEN

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
  onFailure,
  toggleFullscreen,
}: {
  player: NativePlayer
  source: PlayerSource
  onFailure: (message: string) => void
  toggleFullscreen: () => void
}): { engine: EngineHandle; selection: ReturnType<typeof useNativeTrackSelection> } => {
  const { title, trackPicks, isVolumeFixed = false, onEngineError } = useHostServices()
  const setVolume = usePlayerPrefs((prefs) => prefs.setVolume)
  const setCaptionScale = usePlayerPrefs((prefs) => prefs.setCaptionScale)
  const [state, dispatch] = useReducer(videoReducer, title.resumeAt, initialVideoState)
  const [tracks, setTracks] = useState<MediaTracks | null>(null)
  const position = useRef(title.resumeAt)
  const buffered = useRef<Ranges>([])
  const duration = title.duration ?? state.elementDuration
  const selection = useNativeTrackSelection({ tracks, player })

  const fail = useEffectEvent(onFailure)
  const tellHost = useEffectEvent(
    ({ reason, message }: Extract<PlayerEvent, { type: typeof PLAYER_EVENTS.error }>) => {
      if (onEngineError === undefined) return
      onEngineError({ reason, message })
    },
  )
  const current = useEffectEvent(() => ({
    source,
    resumeAt: title.resumeAt,
    picks: trackPicks?.start ?? null,
    isFixed: isVolumeFixed,
  }))
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
          fail(event.message === '' ? COULD_NOT_PLAY : event.message)
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
        type: 'load',
        source: loading,
        start: resumeAt,
        audio: picks?.audio ?? null,
        subtitle: picks?.subtitle ?? null,
      })
      .then(
        () => {
          if (!isCurrent) return
          isLoaded = true
          const prefs = usePlayerPrefs.getState()
          if (!isFixed) {
            sendQuietly({
              player,
              command: { type: 'volume', volume: prefs.volume, muted: prefs.muted },
            })
          }
          sendQuietly({ player, command: { type: 'subtitleScale', scale: prefs.captionScale } })
        },
        (error: unknown) => {
          if (isCurrent) fail(messageOf(error))
        },
      )
    return () => {
      isCurrent = false
      unsubscribe()
      sendQuietly({ player, command: { type: 'stop' } })
    }
  }, [player])

  const actions: EngineHandle['actions'] = {
    play: () => sendQuietly({ player, command: { type: 'play' } }),
    pause: () => sendQuietly({ player, command: { type: 'pause' } }),
    seek: (target) => {
      const to = Math.min(Math.max(0, (duration ?? Infinity) - 0.5), Math.max(0, target))
      position.current = to
      dispatch({ type: 'sought', time: to })
      sendQuietly({ player, command: { type: 'seek', time: to } })
    },
    setVolume: (level) => {
      sendQuietly({ player, command: { type: 'volume', ...level } })
      setVolume(level)
    },
    setRate: (rate) => sendQuietly({ player, command: { type: 'speed', rate } }),
    setAudio: selection.pickAudio,
    setSubtitle: selection.pickSubtitle,
    setSubtitleScale: (scale) => {
      sendQuietly({ player, command: { type: 'subtitleScale', scale } })
      setCaptionScale(scale)
    },
    toggleStats: () => sendQuietly({ player, command: { type: 'stats' } }),
  }

  const engine: EngineHandle = {
    state,
    duration,
    position,
    tracks,
    actions,
    drawsSubtitles: true,
    // The picture's figures stay in mpv; its own overlay (`i`) shows them.
    readStats: () => ({ engine: ENGINE_NAME, viewport: null, frame: null, frames: null }),
    focusSurface: () => {},
    surface: (
      // The window-wide shortcuts are the keyboard path, so the surface takes only the pointer.
      // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
      <div
        className={styles.nativeSurface}
        onClick={() => (state.paused ? actions.play() : actions.pause())}
        onDoubleClick={toggleFullscreen}
      />
    ),
  }
  return { engine, selection }
}
