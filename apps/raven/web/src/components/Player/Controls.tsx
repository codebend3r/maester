import { formatDuration } from '@raven/core'
import type { RefObject } from 'react'
import { Icon, type IconName } from '@/components/Icon/Icon'
import styles from '@/components/Player/Controls.module.scss'
import { Scrubber } from '@/components/Player/Scrubber'

const volumeIcon = ({ volume, muted }: { volume: number; muted: boolean }): IconName => {
  if (muted || volume === 0) return 'muted'
  return volume < 0.5 ? 'volumeLow' : 'volume'
}

/** A round icon button for the bar; every one carries its own label. */
const ControlButton = ({
  icon,
  label,
  onClick,
  pressed,
  expanded,
  className,
  buttonRef,
}: {
  icon: IconName
  label: string
  onClick: () => void
  pressed?: boolean
  expanded?: boolean
  className?: string
  buttonRef?: RefObject<HTMLButtonElement | null>
}) => (
  <button
    ref={buttonRef}
    type="button"
    className={[styles.button, className ?? ''].filter(Boolean).join(' ')}
    aria-label={label}
    aria-pressed={pressed}
    aria-expanded={expanded}
    title={label}
    onClick={onClick}
  >
    <Icon name={icon} size={22} />
  </button>
)

export type ControlsProps = {
  shown: boolean
  paused: boolean
  time: number
  duration: number | null
  buffered: ReadonlyArray<[number, number]>
  volume: number
  muted: boolean
  fullscreen: boolean
  subtitlesOn: boolean
  menuOpen: boolean
  settingsButton: RefObject<HTMLButtonElement | null>
  onTogglePlay: () => void
  onSeek: (time: number) => void
  onSkip: (seconds: number) => void
  onVolume: (volume: number) => void
  onToggleMute: () => void
  onToggleSubtitles: () => void
  onToggleMenu: () => void
  onToggleFullscreen: () => void
}

/**
 * The bar along the bottom: the timeline, then play, skips, volume and the
 * clock on the left, subtitles, settings and full screen on the right.
 */
export const Controls = ({
  shown,
  paused,
  time,
  duration,
  buffered,
  volume,
  muted,
  fullscreen,
  subtitlesOn,
  menuOpen,
  settingsButton,
  onTogglePlay,
  onSeek,
  onSkip,
  onVolume,
  onToggleMute,
  onToggleSubtitles,
  onToggleMenu,
  onToggleFullscreen,
}: ControlsProps) => (
  <div className={[styles.controls, shown ? '' : styles.hidden].filter(Boolean).join(' ')}>
    <div className={styles.timeline}>
      <Scrubber time={time} duration={duration} buffered={buffered} onSeek={onSeek} />
    </div>
    <ControlButton
      icon={paused ? 'play' : 'pause'}
      label={paused ? 'Play (k)' : 'Pause (k)'}
      onClick={onTogglePlay}
      className={styles.play}
    />
    <ControlButton
      icon="rewind"
      label="Back 10 seconds (j)"
      onClick={() => onSkip(-10)}
      className={styles.back}
    />
    <ControlButton
      icon="forward"
      label="Forward 10 seconds (l)"
      onClick={() => onSkip(10)}
      className={styles.forward}
    />
    <div className={styles.volume}>
      <ControlButton
        icon={volumeIcon({ volume, muted })}
        label={muted ? 'Unmute (m)' : 'Mute (m)'}
        onClick={onToggleMute}
      />
      <input
        className={styles.volumeSlider}
        type="range"
        min={0}
        max={100}
        step={1}
        value={Math.round((muted ? 0 : volume) * 100)}
        aria-label="Volume"
        onChange={(event) => onVolume(Number(event.currentTarget.value) / 100)}
      />
    </div>
    <p className={styles.clock}>
      <span>{formatDuration(time)}</span>
      <span className={styles.total}> / {formatDuration(duration)}</span>
    </p>
    <ControlButton
      icon="captions"
      label={subtitlesOn ? 'Subtitles off (c)' : 'Subtitles on (c)'}
      pressed={subtitlesOn}
      onClick={onToggleSubtitles}
      className={[styles.captions, subtitlesOn ? styles.on : ''].filter(Boolean).join(' ')}
    />
    <ControlButton
      icon="settings"
      label="Settings"
      expanded={menuOpen}
      onClick={onToggleMenu}
      buttonRef={settingsButton}
      className={styles.settings}
    />
    <ControlButton
      icon={fullscreen ? 'fullscreenExit' : 'fullscreen'}
      label={fullscreen ? 'Exit full screen (f)' : 'Full screen (f)'}
      onClick={onToggleFullscreen}
      className={styles.fullscreen}
    />
  </div>
)
