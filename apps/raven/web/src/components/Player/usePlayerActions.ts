import type { RefObject } from 'react'
import type { BezelState } from '@/components/Player/Bezel'
import type { TrackSelection } from '@/components/Player/useTrackSelection'
import type { useVideoState } from '@/components/Player/useVideoState'
import { type PlayerAction, stepCaptionScale, stepSpeed } from '@/lib/shortcuts'
import { languageName } from '@/lib/trackLabels'
import { usePlayerPrefs } from '@/stores/playerPrefs'

/** Frames per second to step by when the file does not say. */
const FALLBACK_FRAME_RATE = 24

const clamp = ({ value, min, max }: { value: number; min: number; max: number }): number =>
  Math.min(max, Math.max(min, value))

/** What sits over the picture besides the controls: at most one of the two. */
export type Overlay = 'none' | 'settings' | 'shortcuts'

/**
 * What the player does, for the keys and the buttons alike: `act` answers a
 * shortcut, flashing what it did in the middle of the picture; the buttons
 * call the rest directly, the play button without the flash.
 */
export const usePlayerActions = ({
  videoRef,
  playback: { seek, fileTime, duration },
  selection,
  flash,
  toggleFullscreen,
  overlay,
  setOverlay,
  closeMenu,
  leave,
}: {
  videoRef: RefObject<HTMLVideoElement | null>
  playback: ReturnType<typeof useVideoState>
  selection: TrackSelection
  flash: (next: Omit<BezelState, 'id'>) => void
  toggleFullscreen: () => void
  overlay: Overlay
  setOverlay: (change: (current: Overlay) => Overlay) => void
  closeMenu: () => void
  /** Back to where the viewer came from. */
  leave: () => void
}) => {
  const captionScale = usePlayerPrefs((prefs) => prefs.captionScale)
  const setCaptionScale = usePlayerPrefs((prefs) => prefs.setCaptionScale)

  const togglePlay = () => {
    const element = videoRef.current
    if (!element) return
    if (element.paused) element.play()?.catch(() => undefined)
    else element.pause()
  }

  const changeVolume = (next: number) => {
    const element = videoRef.current
    if (!element) return
    element.volume = clamp({ value: next, min: 0, max: 1 })
    element.muted = element.volume === 0
    flash({
      icon: element.muted ? 'muted' : 'volume',
      text: `${Math.round(element.volume * 100)}%`,
    })
  }

  const toggleMute = () => {
    const element = videoRef.current
    if (!element) return
    element.muted = !element.muted
    flash({ icon: element.muted ? 'muted' : 'volume', text: element.muted ? 'Muted' : 'Sound on' })
  }

  const changeRate = (next: number) => {
    const element = videoRef.current
    if (!element) return
    // The default carries the speed across a change of source, which resets it.
    element.defaultPlaybackRate = next
    element.playbackRate = next
    flash({ icon: 'forward', text: next === 1 ? 'Normal speed' : `${next}×` })
  }

  const toggleSubtitles = () => {
    const hasAny = !!selection.tracks?.subtitles.some((track) => track.supported)
    if (!hasAny && selection.subtitle == null) {
      flash({ icon: 'captions', text: 'No subtitles' })
      return
    }
    const landed = selection.toggleSubtitles()
    flash({
      icon: 'captions',
      text: landed ? `Subtitles: ${languageName(landed.language) ?? 'on'}` : 'Subtitles off',
    })
  }

  const act = (action: PlayerAction) => {
    const element = videoRef.current
    if (!element) return
    const now = fileTime()
    switch (action.type) {
      case 'togglePlay':
        flash({ icon: element.paused ? 'play' : 'pause', text: element.paused ? 'Play' : 'Pause' })
        togglePlay()
        return
      case 'seekBy':
        seek(now + action.seconds)
        flash({
          icon: action.seconds < 0 ? 'rewind' : 'forward',
          text: `${action.seconds < 0 ? 'Back' : 'Forward'} ${Math.abs(action.seconds)}s`,
        })
        return
      case 'seekToFraction':
        if (duration == null) return
        seek(duration * action.fraction)
        flash({ icon: 'forward', text: `${Math.round(action.fraction * 100)}%` })
        return
      case 'seekToEdge':
        seek(action.edge === 'start' ? 0 : (duration ?? now))
        return
      case 'volumeBy':
        changeVolume((element.muted ? 0 : element.volume) + action.delta)
        return
      case 'toggleMute':
        toggleMute()
        return
      case 'toggleFullscreen':
        toggleFullscreen()
        return
      case 'toggleSubtitles':
        toggleSubtitles()
        return
      case 'stepFrame':
        if (!element.paused) element.pause()
        seek(now + action.direction / (selection.tracks?.frameRate ?? FALLBACK_FRAME_RATE))
        return
      case 'stepSpeed':
        changeRate(stepSpeed({ current: element.playbackRate, direction: action.direction }))
        return
      case 'stepCaptionSize': {
        const next = stepCaptionScale({ current: captionScale, direction: action.direction })
        setCaptionScale(next)
        flash({ icon: 'captions', text: `Subtitles ${Math.round(next * 100)}%` })
        return
      }
      case 'showShortcuts':
        setOverlay((current) => (current === 'shortcuts' ? 'none' : 'shortcuts'))
        return
      case 'escape':
        if (overlay === 'shortcuts') setOverlay(() => 'none')
        else if (overlay === 'settings') closeMenu()
        else if (document.fullscreenElement) void document.exitFullscreen()
        else leave()
        return
      default: {
        const unknown: never = action
        return unknown
      }
    }
  }

  return { act, togglePlay, changeVolume, toggleMute, changeRate, toggleSubtitles }
}
