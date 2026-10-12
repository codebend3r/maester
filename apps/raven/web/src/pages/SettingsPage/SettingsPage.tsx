import { type UseQueryResult, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  DEFAULT_DISPLAY_SETTINGS,
  DEFAULT_PLAYBACK_SETTINGS,
  DISPLAY_CHOICES,
  type DisplaySettings,
  PLAYBACK_CHOICES,
  type PlaybackSettings,
} from '@raven/core'
import { type ReactNode, useId, useState } from 'react'
import { Button } from '@/components/Button/Button'
import { Icon, type IconName } from '@/components/Icon/Icon'
import { api } from '@/lib/api'
import { displaySettingsQuery, playbackSettingsQuery } from '@/lib/queries'
import { queryKeys } from '@/lib/queryClient'
import styles from '@/pages/SettingsPage/SettingsPage.module.scss'

/** Every value a setting takes, with its words; a value added in `@raven/core` cannot go unlabelled. */
type Choices<V extends string | number> = Record<V, { label: string; hint: string }>

const TITLES: Choices<DisplaySettings['titles']> = {
  logo: {
    label: 'Logo',
    hint: 'A movie’s page shows its title as TMDB’s logo art where it has one, else in words.',
  },
  text: { label: 'Text', hint: 'Every movie’s page spells its title out in type.' },
}

const DIRECT_PLAY: Choices<PlaybackSettings['directPlay']> = {
  auto: {
    label: 'When the browser can',
    hint: 'The original file plays as it is when the browser takes it; otherwise the server converts it.',
  },
  force: {
    label: 'Always',
    hint: 'The original file is always sent, whatever the check says, unless another audio track is picked and the server can remux for it. For a browser the check underrates; a file it cannot decode will not play.',
  },
}

const TRANSCODING: Choices<PlaybackSettings['transcoding']> = {
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

const MAX_HEIGHT: Choices<PlaybackSettings['maxHeight']> = {
  2160: { label: '4K', hint: 'Transcodes keep the full frame.' },
  1080: { label: '1080p', hint: 'A 4K file is scaled to 1080p; a smaller one is left alone.' },
  720: { label: '720p', hint: 'For a slow network or a small screen.' },
}

const QUALITY: Choices<PlaybackSettings['quality']> = {
  low: { label: 'Low', hint: 'Smallest stream; fine on a phone.' },
  medium: { label: 'Medium', hint: 'A good picture at a moderate bitrate.' },
  high: { label: 'High', hint: 'Near the source; needs a fast network.' },
}

const HW_ACCEL: Choices<PlaybackSettings['hwAccel']> = {
  auto: { label: 'Auto', hint: 'The GPU this machine has, after a test encode; else the CPU.' },
  none: { label: 'CPU only', hint: 'libx264 on the CPU, whatever the machine has.' },
  vaapi: { label: 'VAAPI', hint: 'An Intel or AMD GPU on Linux, through its render node.' },
  videotoolbox: { label: 'VideoToolbox', hint: 'The media engine in a Mac.' },
}

/** Whether every setting in `current` is where a fresh install has it. */
const isAtDefaults = <T extends Record<string, unknown>>({
  current,
  defaults,
}: {
  current: T
  defaults: T
}): boolean => Object.keys(defaults).every((key) => current[key] === defaults[key])

const ENCODER_NAMES = {
  software: 'libx264 on the CPU',
  vaapi: 'VAAPI',
  videotoolbox: 'VideoToolbox',
}

/** A setting's or a section's title with its icon before it. */
const Titled = ({ icon, children }: { icon: IconName; children: string }) => (
  <>
    <Icon name={icon} />
    {children}
  </>
)

/** One setting as a group of radio buttons, each with a line saying what it means. */
const Setting = <V extends string | number>({
  label,
  icon,
  values,
  choices,
  value,
  disabled,
  onChange,
}: {
  label: string
  icon: IconName
  values: readonly V[]
  choices: Choices<V>
  value: V
  disabled: boolean
  onChange: (value: V) => void
}) => {
  const name = useId()
  return (
    <fieldset className={styles.setting} disabled={disabled}>
      <legend className={styles.legend}>
        <Titled icon={icon}>{label}</Titled>
      </legend>
      <div className={styles.choices}>
        {values.map((choice) => (
          <label key={String(choice)} className={styles.choice}>
            <input
              type="radio"
              name={name}
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

/**
 * One source of settings: its heading and what it covers, why it could not
 * be read or saved, a line while it is read, and its settings once known.
 */
const SettingsSection = <T,>({
  icon,
  title,
  hint,
  query,
  saveError,
  children,
}: {
  icon: IconName
  title: string
  hint: string
  query: UseQueryResult<T>
  saveError: Error | null
  children: (data: T) => ReactNode
}) => {
  const headingId = useId()
  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.heading}>
        <Titled icon={icon}>{title}</Titled>
      </h2>
      <p className={styles.hint}>{hint}</p>
      {query.isError && (
        <p className={styles.error} role="alert">
          {query.error.message}
        </p>
      )}
      {saveError && (
        <p className={styles.error} role="alert">
          Could not save: {saveError.message}
        </p>
      )}
      {query.data !== undefined && children(query.data)}
      {query.isPending && <p className={styles.hint}>Reading the settings</p>}
    </section>
  )
}

/**
 * `/settings`: how the server plays video, and how pages look, for every
 * viewer. Each change saves on its own; Reset to defaults puts them all
 * back at once, after a second click to be sure.
 */
export const SettingsPage = () => {
  const titleId = useId()
  const queryClient = useQueryClient()
  const [isConfirming, setConfirming] = useState(false)
  const playback = useQuery(playbackSettingsQuery)
  const display = useQuery(displaySettingsQuery)
  const save = useMutation({
    mutationFn: (change: Partial<PlaybackSettings>) => api.setPlaybackSettings(change),
    onSuccess: (updated) => queryClient.setQueryData(queryKeys.playbackSettings, updated),
  })
  const saveDisplay = useMutation({
    mutationFn: (change: Partial<DisplaySettings>) => api.setDisplaySettings(change),
    onSuccess: (updated) => queryClient.setQueryData(queryKeys.displaySettings, updated),
  })
  const reset = useMutation({
    mutationFn: () =>
      Promise.all([
        api.setPlaybackSettings(DEFAULT_PLAYBACK_SETTINGS),
        api.setDisplaySettings(DEFAULT_DISPLAY_SETTINGS),
      ]),
    onSuccess: ([played, shown]) => {
      queryClient.setQueryData(queryKeys.playbackSettings, played)
      queryClient.setQueryData(queryKeys.displaySettings, shown)
      setConfirming(false)
    },
    // A reset may land on one source and fail on the other; both are read
    // again, so the page shows what the server holds either way.
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.playbackSettings }),
        queryClient.invalidateQueries({ queryKey: queryKeys.displaySettings }),
      ]),
  })
  const settings = playback.data?.settings
  const busy = save.isPending || saveDisplay.isPending || reset.isPending
  const isAllAtDefaults =
    (settings == null ||
      isAtDefaults({ current: settings, defaults: DEFAULT_PLAYBACK_SETTINGS })) &&
    (display.data == null ||
      isAtDefaults({ current: display.data, defaults: DEFAULT_DISPLAY_SETTINGS }))

  return (
    <section className={styles.page} aria-labelledby={titleId}>
      <header className={styles.header}>
        <h1 id={titleId} className={styles.title}>
          Settings
        </h1>
        {settings && (
          <div className={styles.reset}>
            {isConfirming ? (
              <>
                <p className={styles.hint}>Every setting goes back to its default.</p>
                <Button tone="danger" icon="reset" disabled={busy} onClick={() => reset.mutate()}>
                  Reset all
                </Button>
                <Button onClick={() => setConfirming(false)}>Cancel</Button>
              </>
            ) : (
              <Button
                icon="reset"
                disabled={busy || isAllAtDefaults}
                onClick={() => setConfirming(true)}
              >
                Reset to defaults
              </Button>
            )}
          </div>
        )}
      </header>
      <output className={styles.status}>
        {reset.isSuccess && !!settings && isAllAtDefaults
          ? 'Every setting is back to its default.'
          : ''}
      </output>
      {reset.isError && (
        <p className={styles.error} role="alert">
          Could not reset: {reset.error.message}
        </p>
      )}
      <SettingsSection
        icon="playback"
        title="Playback"
        hint="How the server plays video, for every viewer. A change takes effect on the next play."
        query={playback}
        saveError={save.error}
      >
        {({ settings: current, effective }) => (
          <>
            <Setting
              values={PLAYBACK_CHOICES.directPlay}
              icon="file-play"
              label="Play the original file"
              choices={DIRECT_PLAY}
              value={current.directPlay}
              disabled={busy}
              onChange={(directPlay) => save.mutate({ directPlay })}
            />
            <Setting
              values={PLAYBACK_CHOICES.transcoding}
              icon="convert"
              label="Server conversion"
              choices={TRANSCODING}
              value={current.transcoding}
              disabled={busy}
              onChange={(transcoding) => save.mutate({ transcoding })}
            />
            <Setting
              values={PLAYBACK_CHOICES.maxHeight}
              icon="resize"
              label="Transcode size"
              choices={MAX_HEIGHT}
              value={current.maxHeight}
              disabled={busy}
              onChange={(maxHeight) => save.mutate({ maxHeight })}
            />
            <Setting
              values={PLAYBACK_CHOICES.quality}
              icon="gauge"
              label="Transcode quality"
              choices={QUALITY}
              value={current.quality}
              disabled={busy}
              onChange={(quality) => save.mutate({ quality })}
            />
            <Setting
              values={PLAYBACK_CHOICES.hwAccel}
              icon="chip"
              label="Hardware acceleration"
              choices={HW_ACCEL}
              value={current.hwAccel}
              disabled={busy}
              onChange={(hwAccel) => save.mutate({ hwAccel })}
            />
            <p className={styles.hint}>
              Transcodes encode with {ENCODER_NAMES[effective.encoder]} right now.
            </p>
            <fieldset className={styles.setting} disabled={busy}>
              <legend className={styles.legend}>
                <Titled icon="sun">HDR</Titled>
              </legend>
              <label className={styles.choice}>
                <input
                  type="checkbox"
                  checked={current.tonemap}
                  onChange={(event) => save.mutate({ tonemap: event.target.checked })}
                />
                <span className={styles.choiceLabel}>Tone map HDR to SDR on a transcode</span>
                <span className={styles.choiceHint}>
                  {effective.tonemapAvailable
                    ? 'Colours are mapped for an SDR screen; off, HDR goes out as it is and looks flat.'
                    : 'This ffmpeg cannot tone map, so HDR goes out as it is whatever this says.'}
                </span>
              </label>
            </fieldset>
          </>
        )}
      </SettingsSection>
      <SettingsSection
        icon="image"
        title="Display"
        hint="How pages look, for every viewer."
        query={display}
        saveError={saveDisplay.error}
      >
        {(shown) => (
          <Setting
            icon="film"
            label="Movie titles"
            values={DISPLAY_CHOICES.titles}
            choices={TITLES}
            value={shown.titles}
            disabled={busy}
            onChange={(titles) => saveDisplay.mutate({ titles })}
          />
        )}
      </SettingsSection>
    </section>
  )
}
