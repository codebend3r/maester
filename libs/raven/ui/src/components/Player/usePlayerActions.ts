import type { BezelState } from '@/components/Player/Bezel'
import type { TrackSelection } from '@/components/Player/useTrackSelection'
import type { EngineHandle } from '@/components/Player/engine'
import { preferredSubtitle } from '@/components/Player/selection'
import { type PlayerAction, stepCaptionScale, stepSpeed } from '@/lib/shortcuts'
import { languageName } from '@raven/core'
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
  engine: { actions, state, position, duration },
  selection,
  flash,
  toggleFullscreen,
  overlay,
  setOverlay,
  closeMenu,
  leave,
}: {
  engine: EngineHandle
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
  const volume = usePlayerPrefs((prefs) => prefs.volume)
  const muted = usePlayerPrefs((prefs) => prefs.muted)
  const subtitles = usePlayerPrefs((prefs) => prefs.subtitles)
  const seek = actions.seek

  const togglePlay = () => {
    if (state.paused) actions.play()
    else actions.pause()
  }

  const changeVolume = (next: number) => {
    const nextVolume = clamp({ value: next, min: 0, max: 1 })
    const nextMuted = nextVolume === 0
    actions.setVolume({ volume: nextVolume, muted: nextMuted })
    flash({ icon: nextMuted ? 'muted' : 'volume', text: `${Math.round(nextVolume * 100)}%` })
  }

  const toggleMute = () => {
    actions.setVolume({ volume, muted: !muted })
    flash({ icon: !muted ? 'muted' : 'volume', text: !muted ? 'Muted' : 'Sound on' })
  }

  const changeRate = (next: number) => {
    actions.setRate(next)
    flash({ icon: 'forward', text: next === 1 ? 'Normal speed' : `${next}×` })
  }

  const toggleSubtitles = () => {
    const hasAny = !!selection.tracks?.subtitles.some((track) => track.supported)
    if (!hasAny && selection.subtitle == null) {
      flash({ icon: 'captions', text: 'No subtitles' })
      return
    }
    const id =
      selection.subtitle != null
        ? null
        : (preferredSubtitle({
            tracks: selection.tracks,
            subtitles: { on: true, language: subtitles.language },
          }) ??
          preferredSubtitle({ tracks: selection.tracks, subtitles: { on: true, language: null } }))
    actions.setSubtitle(id)
    const landed = selection.tracks?.subtitles.find((track) => track.id === id) ?? null
    flash({
      icon: 'captions',
      text: landed
        ? `Subtitles: ${languageName({ tag: landed.language }) ?? 'on'}`
        : 'Subtitles off',
    })
  }

  const act = (action: PlayerAction) => {
    const now = position.current
    switch (action.type) {
      case 'togglePlay':
        flash({ icon: state.paused ? 'play' : 'pause', text: state.paused ? 'Play' : 'Pause' })
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
        changeVolume((muted ? 0 : volume) + action.delta)
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
        if (!state.paused) actions.pause()
        seek(now + action.direction / (selection.tracks?.frameRate ?? FALLBACK_FRAME_RATE))
        return
      case 'stepSpeed':
        changeRate(stepSpeed({ current: state.rate, direction: action.direction }))
        return
      case 'stepCaptionSize': {
        const next = stepCaptionScale({ current: captionScale, direction: action.direction })
        actions.setSubtitleScale(next)
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
