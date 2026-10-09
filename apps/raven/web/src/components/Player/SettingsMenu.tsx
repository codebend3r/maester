import { type MediaTracks, type PlaybackMode, describeMode } from '@raven/core'
import { type RefObject, useEffect, useId, useRef } from 'react'
import { Icon } from '@/components/Icon/Icon'
import styles from '@/components/Player/SettingsMenu.module.scss'
import type { SubtitleStatus } from '@/components/Player/useSubtitleCues'
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

/**
 * Audio, subtitles and speed, as native radio groups so the arrow keys,
 * the space bar and screen readers all work as they do anywhere else. The
 * last line says how the file is reaching the browser.
 */
export const SettingsMenu = ({
  menuRef,
  tracks,
  tracksFailed,
  audio,
  subtitleId,
  subtitleStatus,
  rate,
  mode,
  onPickAudio,
  onPickSubtitle,
  onPickRate,
  onClose,
}: {
  menuRef: RefObject<HTMLDialogElement | null>
  tracks: MediaTracks | null
  tracksFailed: boolean
  /** The playing track's `0:a:N` index, or null for the default. */
  audio: number | null
  subtitleId: string | null
  subtitleStatus: SubtitleStatus
  rate: number
  mode: PlaybackMode
  onPickAudio: (index: number) => void
  onPickSubtitle: (id: string | null) => void
  onPickRate: (rate: number) => void
  onClose: () => void
}) => {
  const id = useId()
  const heading = `${id}-heading`
  const first = useRef<HTMLFieldSetElement>(null)
  const playingAudio = audio ?? tracks?.defaultAudio ?? null

  // Opening the menu puts the keyboard on the chosen option of the first group.
  useEffect(() => {
    first.current?.querySelector<HTMLInputElement>('input:checked')?.focus()
  }, [])

  const tracksNote = tracksFailed ? 'Tracks unavailable.' : tracks == null ? 'Reading tracks' : null
  const subtitleNote = SUBTITLE_STATUS[subtitleStatus]

  return (
    <div className={styles.layer}>
      <dialog ref={menuRef} open className={styles.menu} aria-labelledby={heading}>
        <header className={styles.header}>
          <h2 id={heading} className={styles.heading}>
            Settings
          </h2>
          <button
            type="button"
            className={styles.close}
            aria-label="Close settings"
            onClick={onClose}
          >
            <Icon name="close" size={18} />
          </button>
        </header>
        <div className={styles.groups}>
          <fieldset ref={first} className={styles.group}>
            <legend className={styles.legend}>Audio</legend>
            {tracks != null && tracks.audio.length > 0 ? (
              tracks.audio.map((track) => {
                const label = audioLabel(track)
                return (
                  <Option
                    key={track.index}
                    name={`${id}-audio`}
                    checked={track.index === playingAudio}
                    label={label.name}
                    details={label.details}
                    onSelect={() => onPickAudio(track.index)}
                  />
                )
              })
            ) : (
              <p className={styles.note}>{tracksNote ?? 'No audio tracks.'}</p>
            )}
          </fieldset>
          <fieldset className={styles.group}>
            <legend className={styles.legend}>Subtitles</legend>
            <Option
              name={`${id}-subtitles`}
              checked={subtitleId == null}
              label="Off"
              onSelect={() => onPickSubtitle(null)}
            />
            {(tracks?.subtitles ?? []).map((track) => {
              const label = subtitleLabel(track)
              return (
                <Option
                  key={track.id}
                  name={`${id}-subtitles`}
                  checked={track.id === subtitleId}
                  disabled={!track.supported}
                  label={label.name}
                  details={label.details}
                  onSelect={() => onPickSubtitle(track.id)}
                />
              )
            })}
            {!!tracksNote && tracks == null && <p className={styles.note}>{tracksNote}</p>}
            {!!subtitleNote && <output className={styles.note}>{subtitleNote}</output>}
          </fieldset>
          <fieldset className={styles.group}>
            <legend className={styles.legend}>Speed</legend>
            <div className={styles.speeds}>
              {SPEEDS.map((speed) => (
                <Option
                  key={speed}
                  name={`${id}-speed`}
                  checked={speed === rate}
                  label={speed === 1 ? 'Normal' : `${speed}×`}
                  onSelect={() => onPickRate(speed)}
                />
              ))}
            </div>
          </fieldset>
        </div>
        <p className={styles.mode}>{describeMode(mode)}</p>
      </dialog>
    </div>
  )
}
