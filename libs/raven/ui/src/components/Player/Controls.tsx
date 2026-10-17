import { formatDuration } from '@raven/core'
import { type ReactNode, type RefObject, useId } from 'react'
import { Icon, type IconName } from '@/components/Icon/Icon'
import styles from '@/components/Player/Controls.module.scss'
import { MENU_SECTIONS, MENU_TITLES, type MenuSection } from '@/components/Player/menus'
import { Scrubber } from '@/components/Player/Scrubber'
import { FIXED_VOLUME_NOTE } from '@/lib/fixedVolume'

const volumeIcon = ({ volume, muted }: { volume: number; muted: boolean }): IconName => {
  if (muted || volume === 0) return 'muted'
  return volume < 0.5 ? 'volumeLow' : 'volume'
}

const muteLabel = ({ isVolumeFixed, muted }: { isVolumeFixed: boolean; muted: boolean }) => {
  if (isVolumeFixed) return FIXED_VOLUME_NOTE
  return muted ? 'Unmute (m)' : 'Mute (m)'
}

/** What each pill wears in place of its words on a phone. */
const MENU_ICONS = {
  subtitles: 'captions',
  audio: 'headphones',
  playback: 'settings',
} as const satisfies Record<MenuSection, IconName>

const classes = (...names: ReadonlyArray<string | false | undefined>): string =>
  names.filter(Boolean).join(' ')

/** A round button for the bar; every one carries its own label. */
const ControlButton = ({
  label,
  onClick,
  className,
  disabled,
  children,
}: {
  label: string
  onClick: () => void
  className?: string
  disabled?: boolean
  children: ReactNode
}) => (
  <button
    type="button"
    className={classes(styles.button, className)}
    aria-label={label}
    title={label}
    disabled={disabled}
    onClick={onClick}
  >
    {children}
  </button>
)

/**
 * A glass pill naming a menu and what it is set to, "Subtitles · English".
 * The quality pill shows only its value, "4K · Direct play". On a phone
 * each shrinks to its icon, its label unchanged.
 */
const MenuPill = ({
  section,
  value,
  open,
  buttonRef,
  onToggle,
}: {
  section: MenuSection
  value: string | null
  open: boolean
  buttonRef: RefObject<HTMLButtonElement | null> | undefined
  onToggle: (section: MenuSection) => void
}) => {
  const title = MENU_TITLES[section]
  const showsTitle = section !== MENU_SECTIONS.playback || value == null
  return (
    <button
      ref={buttonRef}
      type="button"
      className={classes(styles.pill, open && styles.open)}
      aria-label={value == null ? title : `${title}: ${value}`}
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={() => onToggle(section)}
    >
      <span className={styles.pillIcon}>
        <Icon name={MENU_ICONS[section]} size={20} />
      </span>
      <span className={styles.pillText}>
        {showsTitle && title}
        {showsTitle && value != null && <span className={styles.dot}> · </span>}
        {value}
      </span>
    </button>
  )
}

export type ControlsProps = {
  shown: boolean
  paused: boolean
  time: number
  duration: number | null
  buffered: ReadonlyArray<[number, number]>
  /** Where each chapter starts, in seconds; without them the timeline is unbroken. */
  chapters?: readonly number[]
  volume: number
  muted: boolean
  /** The output carries the sound untouched, so the volume cannot change here. */
  isVolumeFixed?: boolean
  fullscreen: boolean
  subtitlesOn: boolean
  /** What each pill says it is set to: "English", "English 5.1", "4K · Direct play". */
  menuValues?: Partial<Record<MenuSection, string | null>>
  /** The menu showing, if any. */
  menuOpen: MenuSection | false
  /** Held by the open menu's pill, for focus to go back to when the menu closes. */
  settingsButton: RefObject<HTMLButtonElement | null>
  onTogglePlay: () => void
  onSeek: (time: number) => void
  onSkip: (seconds: number) => void
  onVolume: (volume: number) => void
  onToggleMute: () => void
  onToggleMenu: (section: MenuSection) => void
  onToggleFullscreen: () => void
}

/**
 * The bar along the bottom: the timeline, then play, the skips, volume and
 * the clock on the left, and glass pills for subtitles, audio, quality and
 * full screen on the right.
 */
export const Controls = ({
  shown,
  paused,
  time,
  duration,
  buffered,
  chapters,
  volume,
  muted,
  isVolumeFixed = false,
  fullscreen,
  subtitlesOn,
  menuValues = {},
  menuOpen,
  settingsButton,
  onTogglePlay,
  onSeek,
  onSkip,
  onVolume,
  onToggleMute,
  onToggleMenu,
  onToggleFullscreen,
}: ControlsProps) => {
  const fixedNote = useId()
  const values: Record<MenuSection, string | null> = {
    subtitles: menuValues.subtitles ?? (subtitlesOn ? 'On' : 'Off'),
    audio: menuValues.audio ?? null,
    playback: menuValues.playback ?? null,
  }
  const fullscreenLabel = fullscreen ? 'Exit full screen' : 'Full screen'
  return (
    <div className={classes(styles.controls, !shown && styles.hidden)}>
      <div className={styles.timeline}>
        <Scrubber
          time={time}
          duration={duration}
          buffered={buffered}
          chapters={chapters}
          onSeek={onSeek}
        />
      </div>
      <ControlButton
        label={paused ? 'Play (k)' : 'Pause (k)'}
        onClick={onTogglePlay}
        className={styles.play}
      >
        <Icon name={paused ? 'play' : 'pause'} size={24} />
      </ControlButton>
      <ControlButton
        label="Back 10 seconds (j)"
        onClick={() => onSkip(-10)}
        className={classes(styles.skip, styles.back)}
      >
        -10
      </ControlButton>
      <ControlButton
        label="Forward 10 seconds (l)"
        onClick={() => onSkip(10)}
        className={classes(styles.skip, styles.forward)}
      >
        +10
      </ControlButton>
      <div className={styles.volume}>
        <ControlButton
          label={muteLabel({ isVolumeFixed, muted })}
          onClick={onToggleMute}
          disabled={isVolumeFixed}
        >
          <Icon name={volumeIcon({ volume, muted })} size={22} />
        </ControlButton>
        <input
          className={styles.volumeSlider}
          type="range"
          min={0}
          max={100}
          step={1}
          value={Math.round((muted ? 0 : volume) * 100)}
          aria-label="Volume"
          aria-describedby={isVolumeFixed ? fixedNote : undefined}
          disabled={isVolumeFixed}
          onChange={(event) => onVolume(Number(event.currentTarget.value) / 100)}
        />
        {isVolumeFixed && (
          <span id={fixedNote} className="visually-hidden">
            {FIXED_VOLUME_NOTE}
          </span>
        )}
      </div>
      <p className={styles.clock}>
        <span>{formatDuration(time)}</span>
        <span className={styles.total}> / {formatDuration(duration)}</span>
      </p>
      <div className={styles.pills}>
        {Object.values(MENU_SECTIONS).map((section) => (
          <MenuPill
            key={section}
            section={section}
            value={values[section]}
            open={menuOpen === section}
            buttonRef={menuOpen === section ? settingsButton : undefined}
            onToggle={onToggleMenu}
          />
        ))}
        <button
          type="button"
          className={styles.pill}
          aria-label={`${fullscreenLabel} (f)`}
          onClick={onToggleFullscreen}
        >
          <span className={styles.pillIcon}>
            <Icon name={fullscreen ? 'fullscreenExit' : 'fullscreen'} size={20} />
          </span>
          <span className={styles.pillText}>{fullscreenLabel}</span>
        </button>
      </div>
    </div>
  )
}
