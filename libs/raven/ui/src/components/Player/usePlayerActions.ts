import { useRef } from 'react'
import type { BezelState } from '@/components/Player/Bezel'
import { PLAYER_ACTIONS_COPY } from '@/components/Player/copy'
import type { TrackSelection } from '@/components/Player/useTrackSelection'
import type { EngineHandle } from '@/components/Player/engine'
import type { MenuSection } from '@/components/Player/menus'
import { preferredSubtitle } from '@/components/Player/selection'
import { FIXED_VOLUME_NOTE } from '@/lib/fixedVolume'
import {
  PLAYER_ACTIONS,
  type PlayerAction,
  SEEK_EDGES,
  type SkipStep,
  languageName,
  stepCaptionScale,
  stepSkip,
  stepSpeed,
} from '@raven/core'
import { useHostServices } from '@/stores/playerServices'
import { usePlayerPrefs } from '@/stores/playerPrefs'

/** Frames per second to step by when the file does not say. */
const FALLBACK_FRAME_RATE = 24

type ClampProps = { value: number; min: number; max: number }

const clamp = ({ value, min, max }: ClampProps): number => Math.min(max, Math.max(min, value))

export const OVERLAYS = { none: 'none', shortcuts: 'shortcuts' } as const

/** What sits over the picture besides the controls: one pill's menu or the shortcuts, never both. */
export type Overlay = (typeof OVERLAYS)[keyof typeof OVERLAYS] | MenuSection

type UsePlayerActionsProps = {
  engine: EngineHandle
  selection: TrackSelection
  flash: (next: Omit<BezelState, 'id'>) => void
  toggleFullscreen: () => void
  overlay: Overlay
  setOverlay: (change: (current: Overlay) => Overlay) => void
  closeMenu: () => void
  /** Puts Playback info away; null while it is not open. */
  closeInfo: (() => void) | null
  /** Back to where the viewer came from. */
  leave: () => void
}

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
  closeInfo,
  leave,
}: UsePlayerActionsProps) => {
  const captionScale = usePlayerPrefs((prefs) => prefs.captionScale)
  const volume = usePlayerPrefs((prefs) => prefs.volume)
  const muted = usePlayerPrefs((prefs) => prefs.muted)
  const subtitles = usePlayerPrefs((prefs) => prefs.subtitles)
  const { isVolumeFixed = false } = useHostServices()
  const seek = actions.seek
  const lastSkip = useRef<SkipStep | null>(null)

  const togglePlay = () => {
    if (state.paused) actions.play()
    else actions.pause()
  }

  const flashFixedVolume = () => flash({ icon: 'volume', text: FIXED_VOLUME_NOTE })

  const changeVolume = (next: number) => {
    if (isVolumeFixed) {
      flashFixedVolume()
      return
    }
    const nextVolume = clamp({ value: next, min: 0, max: 1 })
    const nextMuted = nextVolume === 0
    actions.setVolume({ volume: nextVolume, muted: nextMuted })
    flash({
      icon: nextMuted ? 'muted' : 'volume',
      text: PLAYER_ACTIONS_COPY.percent(Math.round(nextVolume * 100)),
    })
  }

  const toggleMute = () => {
    if (isVolumeFixed) {
      flashFixedVolume()
      return
    }
    actions.setVolume({ volume, muted: !muted })
    flash({
      icon: !muted ? 'muted' : 'volume',
      text: !muted ? PLAYER_ACTIONS_COPY.muted : PLAYER_ACTIONS_COPY.soundOn,
    })
  }

  const changeRate = (next: number) => {
    actions.setRate(next)
    flash({
      icon: 'forward',
      text: next === 1 ? PLAYER_ACTIONS_COPY.normalSpeed : PLAYER_ACTIONS_COPY.rate(next),
    })
  }

  const toggleSubtitles = () => {
    const hasAny = selection.tracks?.subtitles.some((track) => track.supported) ?? false
    if (!hasAny && selection.subtitle == null) {
      flash({ icon: 'captions', text: PLAYER_ACTIONS_COPY.noSubtitles })
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
        ? PLAYER_ACTIONS_COPY.subtitles(
            languageName({ tag: landed.language }) ?? PLAYER_ACTIONS_COPY.subtitlesOn,
          )
        : PLAYER_ACTIONS_COPY.subtitlesOff,
    })
  }

  const act = (action: PlayerAction) => {
    const now = position.current
    switch (action.type) {
      case PLAYER_ACTIONS.togglePlay:
        flash({
          icon: state.paused ? 'play' : 'pause',
          text: state.paused ? PLAYER_ACTIONS_COPY.play : PLAYER_ACTIONS_COPY.pause,
        })
        togglePlay()
        return
      case PLAYER_ACTIONS.skip: {
        const step = stepSkip({
          last: lastSkip.current,
          direction: action.direction,
          at: performance.now(),
        })
        lastSkip.current = step
        seek(now + step.seconds * step.direction)
        flash({
          icon: step.direction < 0 ? 'rewind' : 'forward',
          text: PLAYER_ACTIONS_COPY.skip({ isBack: step.direction < 0, seconds: step.seconds }),
        })
        return
      }
      case PLAYER_ACTIONS.seekToFraction:
        if (duration == null) return
        seek(duration * action.fraction)
        flash({
          icon: 'forward',
          text: PLAYER_ACTIONS_COPY.percent(Math.round(action.fraction * 100)),
        })
        return
      case PLAYER_ACTIONS.seekToEdge:
        seek(action.edge === SEEK_EDGES.start ? 0 : (duration ?? now))
        return
      case PLAYER_ACTIONS.volumeBy:
        changeVolume((muted ? 0 : volume) + action.delta)
        return
      case PLAYER_ACTIONS.toggleMute:
        toggleMute()
        return
      case PLAYER_ACTIONS.toggleFullscreen:
        toggleFullscreen()
        return
      case PLAYER_ACTIONS.toggleSubtitles:
        toggleSubtitles()
        return
      case PLAYER_ACTIONS.stepFrame:
        if (!state.paused) actions.pause()
        seek(now + action.direction / (selection.tracks?.frameRate ?? FALLBACK_FRAME_RATE))
        return
      case PLAYER_ACTIONS.stepSpeed:
        changeRate(stepSpeed({ current: state.rate, direction: action.direction }))
        return
      case PLAYER_ACTIONS.stepCaptionSize: {
        const next = stepCaptionScale({ current: captionScale, direction: action.direction })
        actions.setSubtitleScale(next)
        flash({ icon: 'captions', text: PLAYER_ACTIONS_COPY.subtitleSize(Math.round(next * 100)) })
        return
      }
      case PLAYER_ACTIONS.toggleStats:
        if (actions.toggleStats === undefined) return
        actions.toggleStats()
        return
      case PLAYER_ACTIONS.showShortcuts:
        setOverlay((current) =>
          current === OVERLAYS.shortcuts ? OVERLAYS.none : OVERLAYS.shortcuts,
        )
        return
      case PLAYER_ACTIONS.escape:
        if (overlay === OVERLAYS.shortcuts) setOverlay(() => OVERLAYS.none)
        else if (overlay !== OVERLAYS.none) closeMenu()
        else if (closeInfo) closeInfo()
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
