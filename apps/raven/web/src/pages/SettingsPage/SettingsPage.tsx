import { type UseQueryResult, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  type AdminLock,
  DEFAULT_DISPLAY_SETTINGS,
  DEFAULT_PLAYBACK_SETTINGS,
  DISPLAY_CHOICES,
  type DisplaySettings,
  PLAYBACK_CHOICES,
  type PlaybackSettings,
  isDisplaySettings,
  isPlaybackSettingsState,
} from '@raven/core'
import { type FormEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react'
import { Button } from '@/components/Button/Button'
import { Icon, type IconName } from '@/components/Icon/Icon'
import { Bone, Loading } from '@/components/Skeleton/Skeleton'
import { api } from '@/lib/api'
import { optimisticChange, patchQueries } from '@/lib/optimistic'
import { plural } from '@/lib/plural'
import { adminLockQuery, displaySettingsQuery, playbackSettingsQuery } from '@/lib/queries'
import { mutationKeys, queryKeys } from '@/lib/queryClient'
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

/** `count` settings while they are read: each a title over a choice or two. */
const SettingsSkeleton = ({ count }: { count: number }) => (
  <Loading label="Reading the settings">
    {Array.from({ length: count }, (_, index) => (
      <span key={index} className={styles.choices}>
        <Bone shape="text" width="short" />
        <Bone shape="small" width="most" />
        <Bone shape="small" width="half" />
      </span>
    ))}
  </Loading>
)

/**
 * One source of settings: its heading and what it covers, why it could not
 * be read or saved, the shape of its `count` settings while they are read,
 * and its settings once known.
 */
const SettingsSection = <T,>({
  icon,
  title,
  hint,
  query,
  count,
  saveError,
  children,
}: {
  icon: IconName
  title: string
  hint: string
  query: UseQueryResult<T>
  count: number
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
      {query.isPending && <SettingsSkeleton count={count} />}
    </section>
  )
}

/** Whole seconds until `deadline`, counted down as they pass. */
const Countdown = ({ deadline }: { deadline: number }) => {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [])
  const seconds = Math.max(0, Math.ceil((deadline - now) / 1_000))
  return plural({ n: seconds, one: 'second', many: 'seconds' })
}

/** What the admin lock's toggle says under it; `readAt` is when the lock was read, its countdown's start. */
const AdminLockHint = ({ lock, readAt }: { lock: AdminLock; readAt: number }) => {
  switch (lock.state) {
    case 'on':
      return lock.available ? (
        'Turning it off asks for the admin password.'
      ) : (
        <>
          Set <code>ADMIN_PASSWORD</code> in raven's <code>.env</code> to turn it off.
        </>
      )
    case 'turningOn':
      return (
        <>
          Turns on in <Countdown deadline={readAt + lock.remainingMs} />. Until then, turning it off
          needs no password.
        </>
      )
    case 'off':
      return 'Off in this browser, until it is turned on, 12 hours pass or the server restarts. Turned on, it waits a moment first, so a slip costs no password.'
    default: {
      const unknown: never = lock
      return unknown
    }
  }
}

/**
 * The admin lock, at the foot of the page. It holds in every browser until
 * the admin password is entered there. Turned back on, it waits a moment
 * before it holds, and unticked again in that moment it needs no password,
 * so a slip of the finger costs nothing.
 */
const AdminLockSection = () => {
  const headingId = useId()
  const passwordId = useId()
  const queryClient = useQueryClient()
  const lock = useQuery(adminLockQuery)
  const current = lock.data
  const [isAsking, setAsking] = useState(false)
  const [password, setPassword] = useState('')
  const passwordInput = useRef<HTMLInputElement>(null)
  const settle = (next: AdminLock) => queryClient.setQueryData(queryKeys.adminLock, next)
  const unlock = useMutation({
    mutationFn: (entered: string) => api.unlockAdmin(entered),
    onSuccess: (next) => {
      settle(next)
      setAsking(false)
    },
    onSettled: () => setPassword(''),
  })
  const turnOn = useMutation({ mutationFn: () => api.lockAdmin(), onSuccess: settle })
  const keepOff = useMutation({
    mutationFn: () => api.keepAdminUnlocked(),
    onSuccess: settle,
    // Too late, it holds already: read again, it asks for the password.
    onError: () => queryClient.invalidateQueries({ queryKey: queryKeys.adminLock }),
  })
  const busy = unlock.isPending || turnOn.isPending || keepOff.isPending
  const failure = turnOn.error ?? keepOff.error
  const isAskingNow = isAsking && current?.state === 'on'

  useEffect(() => {
    if (isAskingNow) passwordInput.current?.focus()
  }, [isAskingNow])

  const toggle = ({ from, checked }: { from: AdminLock; checked: boolean }): void => {
    switch (from.state) {
      case 'on':
        unlock.reset()
        setAsking(!checked)
        return
      case 'turningOn':
        if (!checked) keepOff.mutate()
        return
      case 'off':
        if (checked) turnOn.mutate()
        return
      default: {
        const unknown: never = from
        return unknown
      }
    }
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    unlock.mutate(password)
  }

  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.heading}>
        <Titled icon="lock">Admin</Titled>
      </h2>
      <p className={styles.hint}>
        On in every browser until the admin password is entered there. While it is on, locked
        libraries are hidden altogether, so nothing asks for their PIN, and no video can be deleted
        or have its file's path shown.
      </p>
      {lock.isError && (
        <p className={styles.error} role="alert">
          {lock.error.message}
        </p>
      )}
      {failure && (
        <p className={styles.error} role="alert">
          {failure.message}
        </p>
      )}
      {lock.isPending && <SettingsSkeleton count={1} />}
      {current && (
        <label className={styles.choice}>
          <input
            type="checkbox"
            checked={current.state !== 'off' && !isAskingNow}
            disabled={busy || (current.state === 'on' && !current.available)}
            onChange={(event) => toggle({ from: current, checked: event.target.checked })}
          />
          <span className={styles.choiceLabel}>Admin lock</span>
          <span className={styles.choiceHint}>
            <AdminLockHint lock={current} readAt={lock.dataUpdatedAt} />
          </span>
        </label>
      )}
      {isAskingNow && (
        <form className={styles.password} onSubmit={submit}>
          <label htmlFor={passwordId} className={styles.passwordLabel}>
            Admin password
          </label>
          <input
            ref={passwordInput}
            id={passwordId}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {unlock.isError && (
            <p role="alert" className={styles.error}>
              {unlock.error.message}
            </p>
          )}
          <div className={styles.actions}>
            <Button onClick={() => setAsking(false)}>Cancel</Button>
            <Button
              type="submit"
              tone="primary"
              icon="unlock"
              disabled={password === '' || unlock.isPending}
            >
              Turn off
            </Button>
          </div>
        </form>
      )}
    </section>
  )
}

/**
 * `/settings`: how the server plays video, and how pages look, for every
 * viewer, then the admin lock at the foot, for this browser. Each change
 * shows at once and saves on its own behind it, put back if the save
 * fails; Reset to defaults puts the server's settings back at once, after a
 * second click to be sure.
 */
export const SettingsPage = () => {
  const titleId = useId()
  const queryClient = useQueryClient()
  const [isConfirming, setConfirming] = useState(false)
  const playback = useQuery(playbackSettingsQuery)
  const display = useQuery(displaySettingsQuery)
  const save = useMutation({
    mutationFn: (change: Partial<PlaybackSettings>) => api.setPlaybackSettings(change),
    ...optimisticChange<Partial<PlaybackSettings>>({
      queryClient,
      mutationKey: mutationKeys.playbackSettings,
      apply: (change) =>
        patchQueries({
          queryClient,
          filters: [{ queryKey: queryKeys.playbackSettings, exact: true }],
          patch: (data) =>
            isPlaybackSettingsState(data)
              ? { ...data, settings: { ...data.settings, ...change } }
              : data,
        }),
      settle: () =>
        queryClient.invalidateQueries({ queryKey: queryKeys.playbackSettings, exact: true }),
    }),
  })
  const saveDisplay = useMutation({
    mutationFn: (change: Partial<DisplaySettings>) => api.setDisplaySettings(change),
    ...optimisticChange<Partial<DisplaySettings>>({
      queryClient,
      mutationKey: mutationKeys.displaySettings,
      apply: (change) =>
        patchQueries({
          queryClient,
          filters: [{ queryKey: queryKeys.displaySettings, exact: true }],
          patch: (data) => (isDisplaySettings(data) ? { ...data, ...change } : data),
        }),
      settle: () =>
        queryClient.invalidateQueries({ queryKey: queryKeys.displaySettings, exact: true }),
    }),
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
  const isResetting = reset.isPending
  const busy = save.isPending || saveDisplay.isPending || isResetting
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
        count={6}
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
              disabled={isResetting}
              onChange={(directPlay) => save.mutate({ directPlay })}
            />
            <Setting
              values={PLAYBACK_CHOICES.transcoding}
              icon="convert"
              label="Server conversion"
              choices={TRANSCODING}
              value={current.transcoding}
              disabled={isResetting}
              onChange={(transcoding) => save.mutate({ transcoding })}
            />
            <Setting
              values={PLAYBACK_CHOICES.maxHeight}
              icon="resize"
              label="Transcode size"
              choices={MAX_HEIGHT}
              value={current.maxHeight}
              disabled={isResetting}
              onChange={(maxHeight) => save.mutate({ maxHeight })}
            />
            <Setting
              values={PLAYBACK_CHOICES.quality}
              icon="gauge"
              label="Transcode quality"
              choices={QUALITY}
              value={current.quality}
              disabled={isResetting}
              onChange={(quality) => save.mutate({ quality })}
            />
            <Setting
              values={PLAYBACK_CHOICES.hwAccel}
              icon="chip"
              label="Hardware acceleration"
              choices={HW_ACCEL}
              value={current.hwAccel}
              disabled={isResetting}
              onChange={(hwAccel) => save.mutate({ hwAccel })}
            />
            <p className={styles.hint}>
              Transcodes encode with {ENCODER_NAMES[effective.encoder]} right now.
            </p>
            <fieldset className={styles.setting} disabled={isResetting}>
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
        count={1}
        saveError={saveDisplay.error}
      >
        {(shown) => (
          <Setting
            icon="film"
            label="Movie titles"
            values={DISPLAY_CHOICES.titles}
            choices={TITLES}
            value={shown.titles}
            disabled={isResetting}
            onChange={(titles) => saveDisplay.mutate({ titles })}
          />
        )}
      </SettingsSection>
      <AdminLockSection />
    </section>
  )
}
