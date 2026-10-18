import { PLAYBACK_MODES, STREAM_TIME_SHIFT } from '@raven/core'
import { useEffect, useRef } from 'react'
import type { EngineHandle, EngineStats, HtmlSource } from '@/components/Player/engine'
import type { Rendition } from '@/components/Player/rendition'
import styles from '@/components/Player/Player.module.scss'
import { useHostServices } from '@/stores/playerServices'
import { SubtitleOverlay } from '@/components/Player/SubtitleOverlay'
import { useMediaSource } from '@/components/Player/useMediaSource'
import type { Delivery } from '@/lib/streamSource'
import { useSubtitleCues } from '@/components/Player/useSubtitleCues'
import type { TrackSelection } from '@/components/Player/useTrackSelection'
import { useVideoEvents } from '@/components/Player/useVideoEvents'
import { useVideoState } from '@/components/Player/useVideoState'
import { usePlayerPrefs } from '@/stores/playerPrefs'

const ENGINE_NAME = 'HTML video'

export const useHtmlEngine = ({
  source,
  rendition,
  selection,
  onFailure,
  onSlow,
  toggleFullscreen,
}: {
  source: HtmlSource
  rendition: Rendition
  selection: TrackSelection
  onFailure: (message: string) => void
  onSlow?: (delivery: Delivery) => void
  toggleFullscreen: () => void
}) => {
  const { title, posterUrl } = useHostServices()
  const videoRef = useRef<HTMLVideoElement>(null)
  const volume = usePlayerPrefs((prefs) => prefs.volume)
  const muted = usePlayerPrefs((prefs) => prefs.muted)
  const setVolume = usePlayerPrefs((prefs) => prefs.setVolume)
  const captionScale = usePlayerPrefs((prefs) => prefs.captionScale)
  const setCaptionScale = usePlayerPrefs((prefs) => prefs.setCaptionScale)
  const shift = rendition.mode === PLAYBACK_MODES.direct ? 0 : STREAM_TIME_SHIFT
  const playback = useVideoState({
    videoRef,
    shift,
    startAt: title.resumeAt,
    knownDuration: title.duration,
  })
  useMediaSource({
    videoRef,
    source,
    rendition,
    audio: selection.audio,
    position: playback.position,
    playing: playback.playing,
    onRefused: playback.refused,
    onFailure,
    onSlow,
  })
  useVideoEvents({
    videoRef,
    on: {
      loadedmetadata: (element) => {
        element.volume = volume
        element.muted = muted
      },
      volumechange: (element) => setVolume({ volume: element.volume, muted: element.muted }),
    },
  })
  useEffect(() => videoRef.current?.focus(), [])
  const subtitles = useSubtitleCues({
    source,
    track: selection.subtitle,
    time: playback.state.time,
    duration: playback.duration,
  })
  const savedPosition = playback.position
  const position = {
    get current() {
      const element = videoRef.current
      return element && element.readyState >= HTMLMediaElement.HAVE_METADATA
        ? Math.max(0, element.currentTime - shift)
        : savedPosition.current
    },
  }
  const actions: EngineHandle['actions'] = {
    play: () => {
      videoRef.current?.play()?.catch(() => undefined)
    },
    pause: () => videoRef.current?.pause(),
    seek: playback.seek,
    setVolume: (level) => {
      const element = videoRef.current
      if (!element) return
      element.volume = level.volume
      element.muted = level.muted
      setVolume(level)
    },
    setRate: (rate) => {
      const element = videoRef.current
      if (!element) return
      // The default survives a converted source being rebuilt.
      element.defaultPlaybackRate = rate
      element.playbackRate = rate
    },
    setAudio: selection.pickAudio,
    setSubtitle: selection.pickSubtitle,
    setSubtitleScale: setCaptionScale,
  }
  const readStats = (): EngineStats => {
    const element = videoRef.current
    if (!element) return { engine: ENGINE_NAME, viewport: null, frame: null, frames: null }
    // Missing outside a real browser.
    const frameQuality = element.getVideoPlaybackQuality?.() ?? null
    return {
      engine: ENGINE_NAME,
      viewport:
        element.clientWidth > 0
          ? {
              width: element.clientWidth,
              height: element.clientHeight,
              scale: window.devicePixelRatio,
            }
          : null,
      frame:
        element.videoWidth > 0 ? { width: element.videoWidth, height: element.videoHeight } : null,
      frames: frameQuality
        ? { dropped: frameQuality.droppedVideoFrames, total: frameQuality.totalVideoFrames }
        : null,
    }
  }
  const engine: EngineHandle = {
    state: playback.state,
    duration: playback.duration,
    position,
    tracks: selection.tracks,
    actions,
    drawsSubtitles: false,
    readStats,
    focusSurface: () => videoRef.current?.focus(),
    surface: (
      // Subtitles use our themed overlay, including for converted streams.
      // oxlint-disable-next-line jsx-a11y/media-has-caption, jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
      <video
        ref={videoRef}
        className={styles.video}
        poster={posterUrl ?? undefined}
        autoPlay
        playsInline
        preload="auto"
        tabIndex={-1}
        aria-label={title.label}
        onClick={() => (playback.state.paused ? actions.play() : actions.pause())}
        onDoubleClick={toggleFullscreen}
      />
    ),
  }
  return {
    engine,
    subtitleStatus: subtitles.status,
    renderSubtitles: (lifted: boolean) => (
      <SubtitleOverlay
        cues={subtitles.cues}
        video={videoRef}
        shift={shift}
        lifted={lifted}
        scale={captionScale}
      />
    ),
  }
}
