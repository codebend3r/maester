import { type PlaybackMode, SPEEDS, audioLabel, describeMode, subtitleLabel } from '@raven/core'
import { type RefObject, useEffect, useId, useRef } from 'react'
import { Icon } from '@/components/Icon/Icon'
import { MENU_SECTIONS, MENU_TITLES, type MenuSection } from '@/components/Player/menus'
import { stepDownNote } from '@/components/Player/playbackFacts'
import { playingAudio } from '@/components/Player/selection'
import type { ChoiceGroup as Group, PlayChoices } from '@/components/Player/playChoices'
import type { StepDown } from '@/components/Player/usePlaybackLadder'
import styles from '@/components/Player/SettingsMenu.module.scss'
import type { SubtitleStatus } from '@/lib/useTrackCues'
import type { TrackSelection } from '@/components/Player/useTrackSelection'

const SUBTITLE_STATUS: Record<SubtitleStatus, string | null> = {
  off: null,
  loading: 'Loading subtitles',
  ready: null,
  error: 'These subtitles could not be loaded.',
}

const Option = ({
  name,
  checked,
  disabled,
  isInline,
  label,
  details,
  onSelect,
}: {
  name: string
  checked: boolean
  disabled?: boolean
  /** Whether the detail sits beside the label instead of under it. */
  isInline?: boolean
  label: string
  details?: string
  onSelect: () => void
}) => (
  <label
    className={[styles.option, disabled ? styles.disabled : '', isInline ? styles.inline : '']
      .filter(Boolean)
      .join(' ')}
  >
    <input
      className={styles.radio}
      type="radio"
      name={name}
      checked={checked}
      disabled={disabled}
      onChange={onSelect}
    />
    <span className={styles.label}>{label}</span>
    {!!details && <span className={styles.details}>{details}</span>}
  </label>
)

type GroupProps = {
  /** Names the radio group; the menu's heading where the group is the whole menu. */
  labelledBy: string
  selection: TrackSelection
  mode: PlaybackMode
  subtitleStatus: SubtitleStatus
}

const tracksNoteOf = ({ tracksFailed, tracksPending }: TrackSelection): string | null => {
  if (tracksFailed) return 'Tracks unavailable.'
  return tracksPending ? 'Reading tracks' : null
}

const AudioGroup = ({ labelledBy, selection, mode }: GroupProps) => {
  const { tracks, audio, playsPickedAudio, pickAudio } = selection
  const playing = playingAudio({ mode, tracks, audio, playsPickedAudio })
  return (
    <fieldset className={styles.group} aria-labelledby={labelledBy}>
      {tracks != null && tracks.audio.length > 0 ? (
        tracks.audio.map((track) => {
          const label = audioLabel(track)
          return (
            <Option
              key={track.index}
              name={`${labelledBy}-audio`}
              checked={track.index === playing}
              label={label.name}
              details={label.details}
              onSelect={() => pickAudio(track.index)}
            />
          )
        })
      ) : (
        <p className={styles.note}>{tracksNoteOf(selection) ?? 'No audio tracks.'}</p>
      )}
    </fieldset>
  )
}

const SubtitleGroup = ({ labelledBy, selection, subtitleStatus }: GroupProps) => {
  const { tracks, subtitle, pickSubtitle } = selection
  const subtitleId = subtitle?.id ?? null
  const tracksNote = tracksNoteOf(selection)
  const subtitleNote = SUBTITLE_STATUS[subtitleStatus]
  return (
    <fieldset className={styles.group} aria-labelledby={labelledBy}>
      <Option
        name={`${labelledBy}-subtitles`}
        checked={subtitleId == null}
        label="Off"
        onSelect={() => pickSubtitle(null)}
      />
      {(tracks?.subtitles ?? []).map((track) => {
        const label = subtitleLabel(track)
        return (
          <Option
            key={track.id}
            name={`${labelledBy}-subtitles`}
            checked={track.id === subtitleId}
            disabled={!track.supported}
            label={label.name}
            details={label.details}
            onSelect={() => pickSubtitle(track.id)}
          />
        )
      })}
      {!!tracksNote && tracks == null && <p className={styles.note}>{tracksNote}</p>}
      {!!subtitleNote && <output className={styles.note}>{subtitleNote}</output>}
    </fieldset>
  )
}

const ChoiceGroup = ({
  name,
  group,
  select,
}: {
  name: string
  group: Group
  select: PlayChoices['select']
}) => (
  <fieldset className={styles.group}>
    <legend className={styles.legend}>{group.legend}</legend>
    {group.options.map((option) => (
      <Option
        key={option.label}
        name={name}
        checked={option.isChecked}
        label={option.label}
        isInline={group.isInline}
        details={option.details ?? undefined}
        onSelect={() => select(option.pick)}
      />
    ))}
  </fieldset>
)

const SpeedGroup = ({
  name,
  rate,
  onPickRate,
}: {
  name: string
  rate: number
  onPickRate: (rate: number) => void
}) => (
  <fieldset className={styles.group}>
    <legend className={styles.legend}>Speed</legend>
    <div className={styles.speeds}>
      {SPEEDS.map((speed) => (
        <Option
          key={speed}
          name={`${name}-speed`}
          checked={speed === rate}
          label={speed === 1 ? 'Normal' : `${speed}×`}
          onSelect={() => onPickRate(speed)}
        />
      ))}
    </div>
  </fieldset>
)

/** Whether what is up next starts by itself once the video ends. */
const AutoplayGroup = ({
  name,
  autoplay,
  onPickAutoplay,
}: {
  name: string
  autoplay: boolean
  onPickAutoplay: (isOn: boolean) => void
}) => (
  <fieldset className={styles.group}>
    <legend className={styles.legend}>Autoplay</legend>
    <div className={styles.speeds}>
      <Option
        name={`${name}-autoplay`}
        checked={autoplay}
        label="On"
        onSelect={() => onPickAutoplay(true)}
      />
      <Option
        name={`${name}-autoplay`}
        checked={!autoplay}
        label="Off"
        onSelect={() => onPickAutoplay(false)}
      />
    </div>
  </fieldset>
)

/**
 * The menu a pill opens over the picture: the audio tracks, the subtitles,
 * or how the file is reaching the browser, with Playback info for the
 * detail, a host's handoff, and the speed and autoplay under them. Each choice is a
 * native radio group, so the arrow keys, the space bar and screen readers
 * all work as they do anywhere else.
 */
export const SettingsMenu = ({
  section,
  menuRef,
  selection,
  subtitleStatus,
  rate,
  mode,
  steppedDown = null,
  choices = null,
  onPickRate,
  autoplay,
  onPickAutoplay,
  onShowInfo,
  onClose,
  onHandoff,
  handoffLabel,
}: {
  section: MenuSection
  menuRef: RefObject<HTMLDialogElement | null>
  selection: TrackSelection
  subtitleStatus: SubtitleStatus
  rate: number
  mode: PlaybackMode
  steppedDown?: StepDown | null
  /** The ways the file can play, when the viewer may pick one; a local file has one. */
  choices?: PlayChoices | null
  onPickRate: (rate: number) => void
  autoplay: boolean
  onPickAutoplay: (isOn: boolean) => void
  onShowInfo: () => void
  onClose: () => void
  onHandoff?: () => void
  handoffLabel?: string
}) => {
  const id = useId()
  const heading = `${id}-heading`
  const group: GroupProps = { labelledBy: heading, selection, mode, subtitleStatus }
  const groups = useRef<HTMLDivElement>(null)

  // Opening a menu puts the keyboard on its chosen option.
  useEffect(() => {
    const checked = groups.current?.querySelector<HTMLInputElement>('input:checked') ?? null
    if (checked !== null) checked.focus()
  }, [])

  const body = (() => {
    switch (section) {
      case MENU_SECTIONS.audio:
        return <AudioGroup {...group} />
      case MENU_SECTIONS.subtitles:
        return <SubtitleGroup {...group} />
      case MENU_SECTIONS.playback:
        return (
          <>
            {choices?.groups.map((each, index) => (
              <ChoiceGroup
                key={each.legend}
                name={`${id}-choice-${index}`}
                group={each}
                select={choices.select}
              />
            ))}
            <div className={styles.playing}>
              {(choices?.groups.length ?? 0) === 0 && (
                <p className={styles.mode}>{describeMode(mode)}</p>
              )}
              {!!steppedDown && <p className={styles.note}>{stepDownNote(steppedDown)}</p>}
              <button type="button" className={styles.info} onClick={onShowInfo}>
                <span>Playback info</span>
                <Icon name="next" size={16} />
              </button>
              {!!onHandoff && !!handoffLabel && (
                <button type="button" className={styles.handoff} onClick={onHandoff}>
                  <Icon name="play" size={18} />
                  <span>{handoffLabel}</span>
                </button>
              )}
            </div>
            <SpeedGroup name={id} rate={rate} onPickRate={onPickRate} />
            <AutoplayGroup name={id} autoplay={autoplay} onPickAutoplay={onPickAutoplay} />
          </>
        )
      default: {
        const unknown: never = section
        return unknown
      }
    }
  })()

  return (
    <div className={styles.layer}>
      <dialog ref={menuRef} open className={styles.menu} aria-labelledby={heading}>
        <header className={styles.header}>
          <h2 id={heading} className={styles.heading}>
            {MENU_TITLES[section]}
          </h2>
          <button type="button" className={styles.close} aria-label="Close menu" onClick={onClose}>
            <Icon name="close" size={18} />
          </button>
        </header>
        <div ref={groups} className={styles.groups}>
          {body}
        </div>
      </dialog>
    </div>
  )
}
