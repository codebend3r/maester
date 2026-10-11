import {
  type MediaItem,
  type PlaybackMode,
  STREAM_TIME_SHIFT,
  formatDuration,
  mediaLabel,
} from '@raven/core'
import { type SyntheticEvent, useEffect, useEffectEvent, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, ButtonLink } from '@/components/Button/Button'
import { Bezel } from '@/components/Player/Bezel'
import { Controls } from '@/components/Player/Controls'
import styles from '@/components/Player/Player.module.scss'
import { SettingsMenu } from '@/components/Player/SettingsMenu'
import { ShortcutsDialog } from '@/components/Player/ShortcutsDialog'
import { SubtitleOverlay } from '@/components/Player/SubtitleOverlay'
import { useMediaSource } from '@/components/Player/useMediaSource'
import { type Overlay, usePlayerActions } from '@/components/Player/usePlayerActions'
import { useBezel, useFullscreen, useIdle } from '@/components/Player/useStageChrome'
import { useSubtitleCues } from '@/components/Player/useSubtitleCues'
import type { TrackSelection } from '@/components/Player/useTrackSelection'
import { useVideoEvents } from '@/components/Player/useVideoEvents'
import { useVideoState } from '@/components/Player/useVideoState'
import { useWatchProgress } from '@/components/Player/useWatchProgress'
import { api } from '@/lib/api'
import { isTypingTarget } from '@/lib/keyboard'
import { shortcutFor } from '@/lib/shortcuts'
import { usePlayerPrefs } from '@/stores/playerPrefs'

/** How long the controls and cursor linger after the last mouse move or key press. */
const IDLE_MS = 2500

const isControlTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && !!target.closest('button, a')

export type StageProps = {
  media: MediaItem
  backTo: string
  mode: PlaybackMode
  selection: TrackSelection
  onFailure: (message: string) => void
}

/**
 * The video and everything over it, full screen and focused on arrival.
 * Every time here is file time: a converted stream runs `STREAM_TIME_SHIFT`
 * ahead of the file, and `shift` takes that off wherever the element's
 * clock is read or set.
 */
export const Stage = ({ media, backTo, mode, selection, onFailure }: StageProps) => {
  const navigate = useNavigate()
  // "The Matrix (1999)", or "Severance · S01E02 · Half Loop", once matched.
  const label = mediaLabel(media)
  const stage = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const menu = useRef<HTMLDialogElement>(null)
  const settingsButton = useRef<HTMLButtonElement>(null)
  const volume = usePlayerPrefs((prefs) => prefs.volume)
  const muted = usePlayerPrefs((prefs) => prefs.muted)
  const setVolume = usePlayerPrefs((prefs) => prefs.setVolume)
  const captionScale = usePlayerPrefs((prefs) => prefs.captionScale)

  const shift = mode === 'direct' ? 0 : STREAM_TIME_SHIFT
  const resumable = media.position > 0 && media.position < (media.duration ?? Infinity) - 10
  const playback = useVideoState({
    videoRef,
    shift,
    startAt: resumable ? media.position : 0,
    knownDuration: media.duration,
  })
  const { state, duration, seek, fileTime } = playback
  useWatchProgress({ videoRef, media, position: playback.position, duration, fileTime })
  useMediaSource({
    videoRef,
    media,
    mode,
    audio: selection.audio,
    position: playback.position,
    playing: playback.playing,
    onRefused: playback.refused,
    onFailure,
  })
  // Volume carries over from one video to the next.
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

  const idle = useIdle(IDLE_MS)
  const { bezel, flash } = useBezel()
  const fullscreen = useFullscreen(stage)
  const [overlay, setOverlay] = useState<Overlay>('none')
  const [resumedAt, setResumedAt] = useState<number | null>(resumable ? media.position : null)
  const { cues, status: subtitleStatus } = useSubtitleCues({
    mediaId: media.id,
    track: selection.subtitle,
    time: state.time,
    duration,
  })

  // Arriving at the player puts the keyboard on the video straight away, and the title in the tab.
  useEffect(() => {
    videoRef.current?.focus()
    const title = document.title
    document.title = label
    const resumedTimer = window.setTimeout(() => setResumedAt(null), 6000)
    return () => {
      document.title = title
      window.clearTimeout(resumedTimer)
    }
  }, [label])

  const closeMenu = () => {
    setOverlay('none')
    settingsButton.current?.focus()
  }

  const controls = usePlayerActions({
    videoRef,
    playback,
    selection,
    flash,
    toggleFullscreen: fullscreen.toggle,
    overlay,
    setOverlay,
    closeMenu,
    leave: () => navigate(backTo),
  })

  const onKey = useEffectEvent((event: KeyboardEvent) => {
    const action = shortcutFor(event)
    // Form controls keep their own keys (the radios' arrows, the volume
    // slider's); only Escape reaches past them, to close what they sit in.
    if (isTypingTarget(event.target) && action?.type !== 'escape') return
    // A focused button or link answers Space and Enter itself.
    if (isControlTarget(event.target) && (event.key === ' ' || event.key === 'Enter')) return
    idle.wake()
    if (!action) return
    // With the shortcut list open, the keys only close it.
    if (overlay === 'shortcuts' && action.type !== 'escape' && action.type !== 'showShortcuts') {
      return
    }
    event.preventDefault()
    controls.act(action)
  })
  useEffect(() => {
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // A press outside the open menu closes it, as a popover should.
  const onStagePointerDown = (event: SyntheticEvent) => {
    idle.wake()
    const target = event.target
    if (overlay !== 'settings' || !(target instanceof Node)) return
    if (menu.current?.contains(target) || settingsButton.current?.contains(target)) return
    setOverlay('none')
  }

  const startOver = () => {
    seek(0)
    videoRef.current?.play()?.catch(() => undefined)
    setResumedAt(null)
    videoRef.current?.focus()
  }

  const chromeShown = state.paused || idle.active || overlay !== 'none'

  return (
    <div
      ref={stage}
      className={[styles.stage, chromeShown ? '' : styles.idle].filter(Boolean).join(' ')}
      onPointerMove={idle.wake}
      onPointerDown={onStagePointerDown}
    >
      {/* Subtitles are drawn by SubtitleOverlay rather than <track>, so they
          follow the theme and work the same for converted streams. */}
      {/* oxlint-disable-next-line jsx-a11y/media-has-caption, jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions */}
      <video
        ref={videoRef}
        className={styles.video}
        poster={api.thumbnailUrl(media) ?? undefined}
        autoPlay
        playsInline
        preload="auto"
        tabIndex={-1}
        aria-label={label}
        onClick={controls.togglePlay}
        onDoubleClick={fullscreen.toggle}
      />
      <SubtitleOverlay
        cues={cues}
        video={videoRef}
        shift={shift}
        lifted={chromeShown}
        scale={captionScale}
      />
      {state.waiting && !state.paused && <output className={styles.spinner} aria-label="Loading" />}
      {!!bezel && <Bezel key={bezel.id} bezel={bezel} />}
      <p className="visually-hidden" aria-live="polite">
        {bezel?.text}
      </p>
      <header
        className={[styles.chrome, chromeShown ? '' : styles.chromeHidden]
          .filter(Boolean)
          .join(' ')}
      >
        <ButtonLink to={backTo} icon="back" aria-label="Back to library" className={styles.back} />
        <h1 className={styles.title}>{label}</h1>
        {resumedAt != null && (
          <p className={styles.resumed} aria-live="polite">
            <span>Resumed at {formatDuration(resumedAt)}</span>
            <Button onClick={startOver}>Start over</Button>
          </p>
        )}
      </header>
      <Controls
        shown={chromeShown}
        paused={state.paused}
        time={state.time}
        duration={duration}
        buffered={state.buffered}
        volume={volume}
        muted={muted}
        fullscreen={fullscreen.fullscreen}
        subtitlesOn={selection.subtitle != null}
        menuOpen={overlay === 'settings'}
        settingsButton={settingsButton}
        onTogglePlay={controls.togglePlay}
        onSeek={seek}
        onSkip={(seconds) => controls.act({ type: 'seekBy', seconds })}
        onVolume={controls.changeVolume}
        onToggleMute={controls.toggleMute}
        onToggleSubtitles={controls.toggleSubtitles}
        onToggleMenu={() => (overlay === 'settings' ? closeMenu() : setOverlay('settings'))}
        onToggleFullscreen={fullscreen.toggle}
      />
      {overlay === 'settings' && (
        <SettingsMenu
          menuRef={menu}
          selection={selection}
          subtitleStatus={subtitleStatus}
          rate={state.rate}
          mode={mode}
          onPickRate={controls.changeRate}
          onClose={closeMenu}
        />
      )}
      {overlay === 'shortcuts' && <ShortcutsDialog onClose={() => setOverlay('none')} />}
    </div>
  )
}
