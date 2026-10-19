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

/**
 * Next, at the end of the transport whether or not anything is up next: it
 * plays what is up next now. In the video's last seconds, with autoplay on,
 * a ring round it fills as the countdown to what is up next runs out.
 */
const NextButton = ({
  upNext,
  countdown,
  onNext,
}: {
  upNext: string | null
  countdown: number | null
  onNext: () => void
}) => {
  const label = upNext == null ? 'Nothing up next' : `Next: ${upNext}`
  return (
    <button
      type="button"
      className={classes(styles.button, styles.next)}
      aria-label={label}
      title={label}
      disabled={upNext == null}
      onClick={onNext}
    >
      {countdown != null && (
        <svg className={styles.ring} viewBox="0 0 44 44" aria-hidden="true" focusable="false">
          <circle className={styles.ringTrack} cx="22" cy="22" r="20" />
          <circle
            className={styles.ringFill}
            cx="22"
            cy="22"
            r="20"
            pathLength={1}
            strokeDasharray={1}
            strokeDashoffset={1 - countdown}
            data-countdown={countdown}
          />
        </svg>
      )}
      <Icon name="skipNext" size={22} />
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
  /** What is up next, by name; null with nothing to play after this. */
  upNext: string | null
  /** How far the countdown to what is up next has run, 0 to 1; null while none runs. */
  countdown: number | null
  /** "Ends at 2:20 AM": when the video ends at this speed; null while its length is unknown. */
  endsAt: string | null
  onRestart: () => void
  onNext: () => void
  onTogglePlay: () => void
  onSeek: (time: number) => void
  onSkip: (seconds: number) => void
  onVolume: (volume: number) => void
  onToggleMute: () => void
  onToggleMenu: (section: MenuSection) => void
  onToggleFullscreen: () => void
}

/**
 * The bar along the bottom: the time played beside the timeline, then the
 * transport (back to the start, back 10 seconds, play, forward 10 seconds,
 * next) and when the video ends on the left, and volume and glass pills for
 * subtitles, audio, quality and full screen on the right.
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
  upNext,
  countdown,
  endsAt,
  onRestart,
  onNext,
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
        <span className={styles.elapsed}>{formatDuration(time)}</span>
        <Scrubber
          time={time}
          duration={duration}
          buffered={buffered}
          chapters={chapters}
          onSeek={onSeek}
        />
      </div>
      <ControlButton
        label="Back to the start (Home)"
        onClick={onRestart}
        className={styles.restart}
      >
        <Icon name="skipPrevious" size={22} />
      </ControlButton>
      <ControlButton
        label="Back 10 seconds (j)"
        onClick={() => onSkip(-10)}
        className={styles.back}
      >
        <Icon name="rewind" size={24} />
      </ControlButton>
      <ControlButton
        label={paused ? 'Play (k)' : 'Pause (k)'}
        onClick={onTogglePlay}
        className={styles.play}
      >
        <Icon name={paused ? 'play' : 'pause'} size={26} />
      </ControlButton>
      <ControlButton
        label="Forward 10 seconds (l)"
        onClick={() => onSkip(10)}
        className={styles.forward}
      >
        <Icon name="forward" size={24} />
      </ControlButton>
      <NextButton upNext={upNext} countdown={countdown} onNext={onNext} />
      {endsAt != null && <p className={styles.ends}>{endsAt}</p>}
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
