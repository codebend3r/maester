import { type PlaybackMode, SPEEDS, audioLabel, describeMode, subtitleLabel } from '@raven/core'
import { type ComponentType, type RefObject, useEffect, useId, useRef } from 'react'
import { Icon } from '@/components/Icon/Icon'
import { SETTINGS_MENU_COPY } from '@/components/Player/copy'
import { MENU_SECTIONS, MENU_TITLES, type MenuSection } from '@/components/Player/menus'
import { stepDownNote } from '@/components/Player/playbackFacts'
import { playingAudio } from '@/components/Player/selection'
import type { ChoiceGroup as Group, PlayChoices } from '@/components/Player/playChoices'
import type { StepDown } from '@/components/Player/usePlaybackLadder'
import styles from '@/components/Player/SettingsMenu.module.scss'
import type { SubtitleStatus } from '@/lib/useTrackCues'
import type { TrackSelection } from '@/components/Player/useTrackSelection'

const SUBTITLE_STATUS = {
  off: null,
  loading: SETTINGS_MENU_COPY.loadingSubtitles,
  ready: null,
  error: SETTINGS_MENU_COPY.subtitlesFailed,
} as const satisfies Record<SubtitleStatus, string | null>

type OptionProps = {
  name: string
  checked: boolean
  disabled?: boolean
  /** Whether the detail sits beside the label instead of under it. */
  isInline?: boolean
  label: string
  details?: string
  onSelect: () => void
}

const Option = ({ name, checked, disabled, isInline, label, details, onSelect }: OptionProps) => (
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
  if (tracksFailed) return SETTINGS_MENU_COPY.tracksUnavailable
  return tracksPending ? SETTINGS_MENU_COPY.readingTracks : null
}

/** Whether the audio group has tracks to list, or only a note. */
const AUDIO_LISTS = { tracks: 'tracks', note: 'note' } as const

type AudioList = (typeof AUDIO_LISTS)[keyof typeof AUDIO_LISTS]

type AudioTracksProps = GroupProps

const AudioTracks = ({ labelledBy, selection, mode }: AudioTracksProps) => {
  const { tracks, audio, playsPickedAudio, pickAudio } = selection
  const playing = playingAudio({ mode, tracks, audio, playsPickedAudio })
  return (tracks?.audio ?? []).map((track) => {
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
}

type AudioNoteProps = GroupProps

const AudioNote = ({ selection }: AudioNoteProps) => (
  <p className={styles.note}>{tracksNoteOf(selection) ?? SETTINGS_MENU_COPY.noAudioTracks}</p>
)

const AUDIO_VIEWS = {
  [AUDIO_LISTS.tracks]: AudioTracks,
  [AUDIO_LISTS.note]: AudioNote,
} as const satisfies Record<AudioList, ComponentType<GroupProps>>

type AudioGroupProps = GroupProps

const AudioGroup = (group: AudioGroupProps) => {
  const hasTracks = (group.selection.tracks?.audio.length ?? 0) > 0
  const List = AUDIO_VIEWS[hasTracks ? AUDIO_LISTS.tracks : AUDIO_LISTS.note]
  return (
    <fieldset className={styles.group} aria-labelledby={group.labelledBy}>
      <List {...group} />
    </fieldset>
  )
}

type SubtitleGroupProps = GroupProps

const SubtitleGroup = ({ labelledBy, selection, subtitleStatus }: SubtitleGroupProps) => {
  const { tracks, subtitle, pickSubtitle } = selection
  const subtitleId = subtitle?.id ?? null
  const tracksNote = tracksNoteOf(selection)
  const subtitleNote = SUBTITLE_STATUS[subtitleStatus]
  return (
    <fieldset className={styles.group} aria-labelledby={labelledBy}>
      <Option
        name={`${labelledBy}-subtitles`}
        checked={subtitleId == null}
        label={SETTINGS_MENU_COPY.off}
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

type ChoiceGroupProps = {
  name: string
  group: Group
  select: PlayChoices['select']
}

const ChoiceGroup = ({ name, group, select }: ChoiceGroupProps) => (
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

type SpeedGroupProps = {
  name: string
  rate: number
  onPickRate: (rate: number) => void
}

const SpeedGroup = ({ name, rate, onPickRate }: SpeedGroupProps) => (
  <fieldset className={styles.group}>
    <legend className={styles.legend}>{SETTINGS_MENU_COPY.speed}</legend>
    <div className={styles.speeds}>
      {SPEEDS.map((speed) => (
        <Option
          key={speed}
          name={`${name}-speed`}
          checked={speed === rate}
          label={speed === 1 ? SETTINGS_MENU_COPY.normalSpeed : SETTINGS_MENU_COPY.rate(speed)}
          onSelect={() => onPickRate(speed)}
        />
      ))}
    </div>
  </fieldset>
)

type AutoplayGroupProps = {
  name: string
  autoplay: boolean
  onPickAutoplay: (isOn: boolean) => void
}

/** Whether what is up next starts by itself once the video ends. */
const AutoplayGroup = ({ name, autoplay, onPickAutoplay }: AutoplayGroupProps) => (
  <fieldset className={styles.group}>
    <legend className={styles.legend}>{SETTINGS_MENU_COPY.autoplay}</legend>
    <div className={styles.speeds}>
      <Option
        name={`${name}-autoplay`}
        checked={autoplay}
        label={SETTINGS_MENU_COPY.on}
        onSelect={() => onPickAutoplay(true)}
      />
      <Option
        name={`${name}-autoplay`}
        checked={!autoplay}
        label={SETTINGS_MENU_COPY.off}
        onSelect={() => onPickAutoplay(false)}
      />
    </div>
  </fieldset>
)

type MenuBodyProps = GroupProps & {
  /** Names the menu's own radio groups. */
  name: string
  rate: number
  steppedDown: StepDown | null
  choices: PlayChoices | null
  onPickRate: (rate: number) => void
  autoplay: boolean
  onPickAutoplay: (isOn: boolean) => void
  onShowInfo: () => void
  onHandoff?: () => void
  handoffLabel?: string
}

type PlaybackBodyProps = MenuBodyProps

/** How the file is reaching the browser, Playback info, a host's handoff, then the speed and autoplay. */
const PlaybackBody = ({
  mode,
  name,
  rate,
  steppedDown,
  choices,
  onPickRate,
  autoplay,
  onPickAutoplay,
  onShowInfo,
  onHandoff,
  handoffLabel,
}: PlaybackBodyProps) => (
  <>
    {choices?.groups.map((each, index) => (
      <ChoiceGroup
        key={each.legend}
        name={`${name}-choice-${index}`}
        group={each}
        select={choices.select}
      />
    ))}
    <div className={styles.playing}>
      {(choices?.groups.length ?? 0) === 0 && <p className={styles.mode}>{describeMode(mode)}</p>}
      {!!steppedDown && <p className={styles.note}>{stepDownNote(steppedDown)}</p>}
      <button type="button" className={styles.info} onClick={onShowInfo}>
        <span>{SETTINGS_MENU_COPY.playbackInfo}</span>
        <Icon name="next" size={16} />
      </button>
      {!!onHandoff && !!handoffLabel && (
        <button type="button" className={styles.handoff} onClick={onHandoff}>
          <Icon name="play" size={18} />
          <span>{handoffLabel}</span>
        </button>
      )}
    </div>
    <SpeedGroup name={name} rate={rate} onPickRate={onPickRate} />
    <AutoplayGroup name={name} autoplay={autoplay} onPickAutoplay={onPickAutoplay} />
  </>
)

const MENU_BODIES = {
  [MENU_SECTIONS.audio]: AudioGroup,
  [MENU_SECTIONS.subtitles]: SubtitleGroup,
  [MENU_SECTIONS.playback]: PlaybackBody,
} as const satisfies Record<MenuSection, ComponentType<MenuBodyProps>>

type SettingsMenuProps = {
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
}

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
}: SettingsMenuProps) => {
  const id = useId()
  const heading = `${id}-heading`
  const Body = MENU_BODIES[section]
  const groups = useRef<HTMLDivElement>(null)

  // Opening a menu puts the keyboard on its chosen option.
  useEffect(() => {
    const checked = groups.current?.querySelector<HTMLInputElement>('input:checked') ?? null
    if (checked !== null) checked.focus()
  }, [])

  return (
    <div className={styles.layer}>
      <dialog ref={menuRef} open className={styles.menu} aria-labelledby={heading}>
        <header className={styles.header}>
          <h2 id={heading} className={styles.heading}>
            {MENU_TITLES[section]}
          </h2>
          <button
            type="button"
            className={styles.close}
            aria-label={SETTINGS_MENU_COPY.closeMenu}
            onClick={onClose}
          >
            <Icon name="close" size={18} />
          </button>
        </header>
        <div ref={groups} className={styles.groups}>
          <Body
            labelledBy={heading}
            selection={selection}
            mode={mode}
            subtitleStatus={subtitleStatus}
            name={id}
            rate={rate}
            steppedDown={steppedDown}
            choices={choices}
            onPickRate={onPickRate}
            autoplay={autoplay}
            onPickAutoplay={onPickAutoplay}
            onShowInfo={onShowInfo}
            onHandoff={onHandoff}
            handoffLabel={handoffLabel}
          />
        </div>
      </dialog>
    </div>
  )
}
