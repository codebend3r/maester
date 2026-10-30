import { formatDuration } from '@raven/core'
import { type ComponentPropsWithRef, type ReactNode, type RefObject, useId, useState } from 'react'
import { Icon } from '@/components/Icon/Icon'
import type { IconName } from '@/components/Icon/drawings'
import { CountdownRing } from '@/components/Player/CountdownRing'
import styles from '@/components/Player/Controls.module.scss'
import { CONTROLS_COPY } from '@/components/Player/copy'
import { MENU_SECTIONS, MENU_TITLES, type MenuSection } from '@/components/Player/menus'
import { Scrubber } from '@/components/Player/Scrubber'
import { FIXED_VOLUME_NOTE } from '@/lib/fixedVolume'

type VolumeIconProps = { volume: number; muted: boolean }

const volumeIcon = ({ volume, muted }: VolumeIconProps): IconName => {
  if (muted || volume === 0) return 'muted'
  return volume < 0.5 ? 'volumeLow' : 'volume'
}

type MuteLabelProps = { isVolumeFixed: boolean; muted: boolean }

const muteLabel = ({ isVolumeFixed, muted }: MuteLabelProps) => {
  if (isVolumeFixed) return FIXED_VOLUME_NOTE
  return muted ? CONTROLS_COPY.unmute : CONTROLS_COPY.mute
}

/** What each pill wears; its words show in a tip on hover or focus. */
const MENU_ICONS = {
  subtitles: 'captions',
  audio: 'headphones',
  playback: 'settings',
} as const satisfies Record<MenuSection, IconName>

const classes = (...names: ReadonlyArray<string | false | undefined>): string =>
  names.filter(Boolean).join(' ')

type ControlButtonProps = {
  label: string
  onClick: () => void
  className?: string
  disabled?: boolean
  children: ReactNode
}

/** A round button for the bar; every one carries its own label. */
const ControlButton = ({ label, onClick, className, disabled, children }: ControlButtonProps) => (
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

type PillProps = ComponentPropsWithRef<'button'> & {
  label: string
  icon: IconName
  /** The tip's words. */
  tip: ReactNode
}

/**
 * A round glass button for the right of the bar. It wears only its icon at
 * every width, and its words show in a tip above it on hover or focus.
 */
const Pill = ({ label, icon, tip, ...button }: PillProps) => (
  <button {...button} type="button" className={styles.pill} aria-label={label}>
    <Icon name={icon} size={20} />
    <span className={styles.tip} aria-hidden="true">
      {tip}
    </span>
  </button>
)

type MenuPillProps = {
  section: MenuSection
  value: string | null
  open: boolean
  buttonRef: RefObject<HTMLButtonElement | null> | undefined
  onToggle: (section: MenuSection) => void
}

/**
 * A pill naming a menu and what it is set to, "Subtitles · English". The
 * quality pill's tip shows only its value, "4K · Direct play".
 */
const MenuPill = ({ section, value, open, buttonRef, onToggle }: MenuPillProps) => {
  const title = MENU_TITLES[section]
  const showsTitle = section !== MENU_SECTIONS.playback || value == null
  return (
    <Pill
      ref={buttonRef}
      label={value == null ? title : CONTROLS_COPY.menuPillLabel({ title, value })}
      icon={MENU_ICONS[section]}
      tip={
        <>
          {showsTitle && title}
          {showsTitle && value != null && (
            <span className={styles.dot}>{CONTROLS_COPY.separator}</span>
          )}
          {value}
        </>
      }
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={() => onToggle(section)}
    />
  )
}

type EndTimeProps = { duration: number; endsAt: string }

/**
 * The video's length, or with a press the clock time it ends at; the
 * length comes first. The bar leaves it out while the length is unknown.
 */
const EndTime = ({ duration, endsAt }: EndTimeProps) => {
  const [showsEndTime, setShowsEndTime] = useState(false)
  const length = formatDuration(duration)
  return (
    <button
      type="button"
      className={styles.ends}
      aria-label={
        showsEndTime ? CONTROLS_COPY.showLength(endsAt) : CONTROLS_COPY.showEndTime(length)
      }
      onClick={() => setShowsEndTime((current) => !current)}
    >
      {showsEndTime ? endsAt : length}
    </button>
  )
}

type NextButtonProps = {
  upNext: string | null
  countdown: number | null
  onNext: () => void
}

/**
 * Next, at the end of the transport whether or not anything is up next: it
 * plays what is up next now. In the video's last seconds, with autoplay on,
 * a ring round it fills as the countdown to what is up next runs out.
 */
const NextButton = ({ upNext, countdown, onNext }: NextButtonProps) => {
  const label = upNext == null ? CONTROLS_COPY.nothingUpNext : CONTROLS_COPY.next(upNext)
  return (
    <button
      type="button"
      className={classes(styles.button, styles.next)}
      aria-label={label}
      title={label}
      disabled={upNext == null}
      onClick={onNext}
    >
      {countdown != null && <CountdownRing countdown={countdown} />}
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
  /** The up next card, above the timeline at the right, while it shows. */
  card?: ReactNode
  /**
   * "Ends at 2:20 AM": when the video ends at this speed; null while its
   * length is unknown. The bar shows the length until it is pressed.
   */
  endsAt: string | null
  onRestart: () => void
  onNext: () => void
  onTogglePlay: () => void
  onSeek: (time: number) => void
  /** Back or forward 10 seconds, further on quick presses. */
  onSkip: (direction: 1 | -1) => void
  onVolume: (volume: number) => void
  onToggleMute: () => void
  onToggleMenu: (section: MenuSection) => void
  onToggleFullscreen: () => void
}

/**
 * The bar along the bottom: the up next card at its right while it shows,
 * the time played beside the timeline, then the
 * transport (back to the start, back 10 seconds, play, forward 10 seconds,
 * next) and the video's length or end time on the left, and volume and glass
 * icon pills for subtitles, audio, quality and full screen on the right.
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
  card,
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
    subtitles:
      menuValues.subtitles ??
      (subtitlesOn ? CONTROLS_COPY.subtitlesOn : CONTROLS_COPY.subtitlesOff),
    audio: menuValues.audio ?? null,
    playback: menuValues.playback ?? null,
  }
  const fullscreenLabel = fullscreen ? CONTROLS_COPY.exitFullScreen : CONTROLS_COPY.fullScreen
  return (
    <div className={classes(styles.controls, !!card && styles.withCard, !shown && styles.hidden)}>
      {!!card && <div className={styles.card}>{card}</div>}
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
      <ControlButton label={CONTROLS_COPY.restart} onClick={onRestart} className={styles.restart}>
        <Icon name="skipPrevious" size={22} />
      </ControlButton>
      <ControlButton label={CONTROLS_COPY.back} onClick={() => onSkip(-1)} className={styles.back}>
        <Icon name="rewind" size={24} />
      </ControlButton>
      <ControlButton
        label={paused ? CONTROLS_COPY.play : CONTROLS_COPY.pause}
        onClick={onTogglePlay}
        className={styles.play}
      >
        <Icon name={paused ? 'play' : 'pause'} size={26} />
      </ControlButton>
      <ControlButton
        label={CONTROLS_COPY.forward}
        onClick={() => onSkip(1)}
        className={styles.forward}
      >
        <Icon name="forward" size={24} />
      </ControlButton>
      <NextButton upNext={upNext} countdown={countdown} onNext={onNext} />
      {duration != null && endsAt != null && <EndTime duration={duration} endsAt={endsAt} />}
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
          aria-label={CONTROLS_COPY.volume}
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
        <Pill
          label={CONTROLS_COPY.fullScreenShortcut(fullscreenLabel)}
          icon={fullscreen ? 'fullscreenExit' : 'fullscreen'}
          tip={fullscreenLabel}
          onClick={onToggleFullscreen}
        />
      </div>
    </div>
  )
}
