import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PLAYBACK_CHOICES, type PlaybackSettings } from '@raven/core'
import { useId } from 'react'
import { api } from '@/lib/api'
import { playbackSettingsQuery } from '@/lib/queries'
import { queryKeys } from '@/lib/queryClient'
import styles from '@/pages/SettingsPage/SettingsPage.module.scss'

type ChoiceKey = keyof typeof PLAYBACK_CHOICES

type ChoiceValue<K extends ChoiceKey> = (typeof PLAYBACK_CHOICES)[K][number]

/** Every value a setting takes, with its words; a value added in `@raven/core` cannot go unlabelled. */
type Choices<K extends ChoiceKey> = Record<ChoiceValue<K>, { label: string; hint: string }>

const DIRECT_PLAY: Choices<'directPlay'> = {
  auto: {
    label: 'When the browser can',
    hint: 'The original file plays as it is when the browser takes it; otherwise the server converts it.',
  },
  force: {
    label: 'Always',
    hint: 'The original file is always sent, whatever the check says, unless another audio track is picked and the server can remux for it. For a browser the check underrates; a file it cannot decode will not play.',
  },
}

const TRANSCODING: Choices<'transcoding'> = {
  on: {
    label: 'Remux and transcode',
    hint: 'Video is repackaged when the browser can decode it and re-encoded when it cannot.',
  },
  remuxOnly: {
    label: 'Remux only',
    hint: 'Video is never re-encoded; a file the browser cannot decode will not play. Easy on the CPU.',
  },
  off: {
    label: 'Off',
    hint: 'Nothing is converted; only files the browser plays as they are play.',
  },
}

const MAX_HEIGHT: Choices<'maxHeight'> = {
  2160: { label: '4K', hint: 'Transcodes keep the full frame.' },
  1080: { label: '1080p', hint: 'A 4K file is scaled to 1080p; a smaller one is left alone.' },
  720: { label: '720p', hint: 'For a slow network or a small screen.' },
}

const QUALITY: Choices<'quality'> = {
  low: { label: 'Low', hint: 'Smallest stream; fine on a phone.' },
  medium: { label: 'Medium', hint: 'A good picture at a moderate bitrate.' },
  high: { label: 'High', hint: 'Near the source; needs a fast network.' },
}

const HW_ACCEL: Choices<'hwAccel'> = {
  auto: { label: 'Auto', hint: 'The GPU this machine has, after a test encode; else the CPU.' },
  none: { label: 'CPU only', hint: 'libx264 on the CPU, whatever the machine has.' },
  vaapi: { label: 'VAAPI', hint: 'An Intel or AMD GPU on Linux, through its render node.' },
  videotoolbox: { label: 'VideoToolbox', hint: 'The media engine in a Mac.' },
}

const ENCODER_NAMES = {
  software: 'libx264 on the CPU',
  vaapi: 'VAAPI',
  videotoolbox: 'VideoToolbox',
}

/** One setting as a group of radio buttons, each with a line saying what it means. */
const Setting = <K extends ChoiceKey>({
  name,
  label,
  choices,
  value,
  disabled,
  onChange,
}: {
  name: K
  label: string
  choices: Choices<K>
  value: ChoiceValue<K>
  disabled: boolean
  onChange: (value: ChoiceValue<K>) => void
}) => {
  const values: readonly ChoiceValue<K>[] = PLAYBACK_CHOICES[name]
  const id = useId()
  return (
    <fieldset className={styles.setting} disabled={disabled}>
      <legend className={styles.legend}>{label}</legend>
      <div className={styles.choices}>
        {values.map((choice) => (
          <label key={String(choice)} className={styles.choice}>
            <input
              type="radio"
              name={`${id}-${name}`}
              checked={choice === value}
              onChange={() => onChange(choice)}
            />
            <span className={styles.choiceLabel}>{choices[choice].label}</span>
            <span className={styles.choiceHint}>{choices[choice].hint}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

/** `/settings`: how the server plays video, for every viewer. Each change saves on its own. */
export const SettingsPage = () => {
  const ids = { title: useId(), playback: useId() }
  const queryClient = useQueryClient()
  const state = useQuery(playbackSettingsQuery)
  const save = useMutation({
    mutationFn: (change: Partial<PlaybackSettings>) => api.setPlaybackSettings(change),
    onSuccess: (updated) => queryClient.setQueryData(queryKeys.playbackSettings, updated),
  })
  const settings = state.data?.settings
  const change =
    <K extends ChoiceKey>(key: K) =>
    (value: ChoiceValue<K>) =>
      save.mutate({ [key]: value })

  return (
    <section className={styles.page} aria-labelledby={ids.title}>
      <h1 id={ids.title} className={styles.title}>
        Settings
      </h1>
      <section className={styles.section} aria-labelledby={ids.playback}>
        <h2 id={ids.playback} className={styles.heading}>
          Playback
        </h2>
        <p className={styles.hint}>
          How the server plays video, for every viewer. A change takes effect on the next play.
        </p>
        {state.isError && (
          <p className={styles.error} role="alert">
            {state.error.message}
          </p>
        )}
        {save.isError && (
          <p className={styles.error} role="alert">
            Could not save: {save.error.message}
          </p>
        )}
        {settings && state.data && (
          <>
            <Setting
              name="directPlay"
              label="Play the original file"
              choices={DIRECT_PLAY}
              value={settings.directPlay}
              disabled={save.isPending}
              onChange={change('directPlay')}
            />
            <Setting
              name="transcoding"
              label="Server conversion"
              choices={TRANSCODING}
              value={settings.transcoding}
              disabled={save.isPending}
              onChange={change('transcoding')}
            />
            <Setting
              name="maxHeight"
              label="Transcode size"
              choices={MAX_HEIGHT}
              value={settings.maxHeight}
              disabled={save.isPending}
              onChange={change('maxHeight')}
            />
            <Setting
              name="quality"
              label="Transcode quality"
              choices={QUALITY}
              value={settings.quality}
              disabled={save.isPending}
              onChange={change('quality')}
            />
            <Setting
              name="hwAccel"
              label="Hardware acceleration"
              choices={HW_ACCEL}
              value={settings.hwAccel}
              disabled={save.isPending}
              onChange={change('hwAccel')}
            />
            <p className={styles.hint}>
              Transcodes encode with {ENCODER_NAMES[state.data.effective.encoder]} right now.
            </p>
            <fieldset className={styles.setting} disabled={save.isPending}>
              <legend className={styles.legend}>HDR</legend>
              <label className={styles.choice}>
                <input
                  type="checkbox"
                  checked={settings.tonemap}
                  onChange={(event) => save.mutate({ tonemap: event.target.checked })}
                />
                <span className={styles.choiceLabel}>Tone map HDR to SDR on a transcode</span>
                <span className={styles.choiceHint}>
                  {state.data.effective.tonemapAvailable
                    ? 'Colours are mapped for an SDR screen; off, HDR goes out as it is and looks flat.'
                    : 'This ffmpeg cannot tone map, so HDR goes out as it is whatever this says.'}
                </span>
              </label>
            </fieldset>
          </>
        )}
        {state.isPending && !state.isError && <p className={styles.hint}>Reading the settings</p>}
      </section>
    </section>
  )
}
