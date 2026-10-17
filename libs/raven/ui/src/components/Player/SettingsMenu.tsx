import { type PlaybackMode, describeMode } from '@raven/core'
import { type RefObject, useEffect, useId, useRef } from 'react'
import { Icon } from '@/components/Icon/Icon'
import { MENU_TITLES, type MenuSection } from '@/components/Player/menus'
import { playingAudio } from '@/components/Player/selection'
import styles from '@/components/Player/SettingsMenu.module.scss'
import type { SubtitleStatus } from '@/components/Player/useSubtitleCues'
import type { TrackSelection } from '@/components/Player/useTrackSelection'
import { SPEEDS } from '@/lib/shortcuts'
import { audioLabel, subtitleLabel } from '@/lib/trackLabels'

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
  label,
  details,
  onSelect,
}: {
  name: string
  checked: boolean
  disabled?: boolean
  label: string
  details?: string
  onSelect: () => void
}) => (
  <label className={[styles.option, disabled ? styles.disabled : ''].filter(Boolean).join(' ')}>
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

/**
 * The menu a pill opens over the picture: the audio tracks, the subtitles,
 * or how the file is reaching the browser, with Playback info for the
 * detail, a host's handoff, and the speed under them. Each choice is a
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
  onPickRate,
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
  onPickRate: (rate: number) => void
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
      case 'audio':
        return <AudioGroup {...group} />
      case 'subtitles':
        return <SubtitleGroup {...group} />
      case 'playback':
        return (
          <>
            <div className={styles.playing}>
              <p className={styles.mode}>{describeMode(mode)}</p>
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
