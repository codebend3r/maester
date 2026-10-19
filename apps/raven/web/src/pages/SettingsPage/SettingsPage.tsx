import { type UseQueryResult, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ADMIN_LOCK_STATES,
  type AdminLock,
  DEFAULT_DISPLAY_SETTINGS,
  DEFAULT_PLAYBACK_SETTINGS,
  DISPLAY_CHOICES,
  type DisplaySettings,
  PLAYBACK_CHOICES,
  type PlaybackSettings,
} from '@raven/core'
import { type FormEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react'
import { AdminOnly } from '@/components/AdminOnly/AdminOnly'
import { Button, CONTROLS_LINGER_SECONDS, type IconName, usePlayerPrefs } from '@raven/ui'
import { BackButton, HOME } from '@/components/BackButton/BackButton'
import { Bone, Loading } from '@/components/Skeleton/Skeleton'
import { ACCESS_KINDS, useAccessState } from '@/lib/accessState'
import { useCanManage } from '@/lib/adminLock'
import { api } from '@/lib/api'
import { edit, useOptimisticMutation } from '@/lib/optimistic'
import { plural } from '@/lib/plural'
import { adminLockQuery, displaySettingsQuery, playbackSettingsQuery } from '@/lib/queries'
import { mutationKeys, queryKeys } from '@/lib/queryClient'
import { AccountSection } from '@/pages/SettingsPage/AccountSection'
import { Titled } from '@/pages/SettingsPage/Titled'
import { UsersSection } from '@/pages/SettingsPage/UsersSection'
import styles from '@/pages/SettingsPage/SettingsPage.module.scss'

/** Every value a setting takes, with its words; a value added in `@raven/core` cannot go unlabelled. */
type Choices<V extends string | number> = Record<V, { label: string; hint: string }>

const TITLES: Choices<DisplaySettings['titles']> = {
  logo: {
    label: 'Logo',
    hint: 'A movie’s or show’s page shows its title as TMDB’s logo art where it has one, else in words.',
  },
  text: { label: 'Text', hint: 'Every movie’s and show’s page spells its title out in type.' },
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

/** One setting as a group of radio cards, each with a line saying what it means; the chosen one is filled. */
const Setting = <V extends string | number>({
  label,
  icon,
  values,
  choices,
  value,
  onChange,
}: {
  label: string
  icon: IconName
  values: readonly V[]
  choices: Choices<V>
  value: V
  onChange: (value: V) => void
}) => {
  const name = useId()
  return (
    <fieldset className={styles.setting}>
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

/** `count` settings on their way: each a title over a card or two. */
const SettingsSkeleton = ({ count }: { count: number }) =>
  Array.from({ length: count }, (_, index) => (
    <span key={index} className={styles.choices}>
      <Bone shape="text" width="short" />
      <Bone shape="heading" />
      <Bone shape="heading" />
    </span>
  ))

/**
 * One source of settings: its heading and what it covers, that the admin
 * lock keeps them as they are, why they could not be read or saved, `shape`
 * while they are read, and its settings once known. One fieldset holds them
 * all, disabled while the admin lock is on or a reset is saving. `browser`
 * holds what this browser keeps for itself, after and outside that fieldset,
 * so neither the admin lock nor the server's answer has a say in it.
 */
const SettingsSection = <T,>({
  icon,
  title,
  hint,
  isResetting,
  query,
  shape,
  saveError,
  browser,
  children,
}: {
  icon: IconName
  title: string
  hint: string
  isResetting: boolean
  query: UseQueryResult<T>
  shape: ReactNode
  saveError: Error | null
  browser?: ReactNode
  children: (data: T) => ReactNode
}) => {
  const headingId = useId()
  const canManage = useCanManage()
  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <header className={styles.sectionHead}>
        <h2 id={headingId} className={styles.heading}>
          <Titled icon={icon}>{title}</Titled>
        </h2>
        <p className={styles.help}>
          {hint}
          {!canManage && (
            <>
              {' '}
              <span>Turn the admin lock off below to change these.</span>
            </>
          )}
        </p>
      </header>
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
      {/* The section names these already, so the fieldset is no group of its own to a screen reader. */}
      {query.data !== undefined && (
        <fieldset role="none" className={styles.settings} disabled={!canManage || isResetting}>
          {children(query.data)}
        </fieldset>
      )}
      {query.isPending && <Loading label="Reading the settings">{shape}</Loading>}
      {browser}
    </section>
  )
}

/**
 * Playback that this browser keeps for itself. Off by default: a page cannot
 * tell whether raven player is installed, and a `raven://` link nothing
 * handles does nothing in Chrome and shows an error in Safari.
 */
const BrowserPlayback = () => {
  const opensInRavenPlayer = usePlayerPrefs((prefs) => prefs.opensInRavenPlayer)
  const setOpensInRavenPlayer = usePlayerPrefs((prefs) => prefs.setOpensInRavenPlayer)
  // Headed rather than grouped: the section's groups are the server's settings.
  return (
    <section className={styles.setting}>
      <h3 className={styles.subheading}>
        <Titled icon="globe">This browser</Titled>
      </h3>
      <label className={styles.choice}>
        <input
          type="checkbox"
          checked={opensInRavenPlayer}
          onChange={(event) => setOpensInRavenPlayer(event.target.checked)}
        />
        <span className={styles.choiceLabel}>Open videos in raven player</span>
        <span className={styles.choiceHint}>
          Offers raven player for videos this browser cannot play, in the player's settings, and
          Download to raven player on a title's page. Turn it on only where raven player is
          installed.
        </span>
      </label>
    </section>
  )
}

/**
 * Settings few need, which this browser keeps for itself, so neither the
 * admin lock nor Reset to defaults has a say in them. For now, how long the
 * player's controls linger.
 */
const AdvancedSection = () => {
  const ids = { heading: useId(), linger: useId() }
  const lingerSeconds = usePlayerPrefs((prefs) => prefs.controlsLingerSeconds)
  const setLingerSeconds = usePlayerPrefs((prefs) => prefs.setControlsLingerSeconds)
  const lingerWords = `${lingerSeconds} seconds`
  return (
    <section className={styles.section} aria-labelledby={ids.heading}>
      <header className={styles.sectionHead}>
        <h2 id={ids.heading} className={styles.heading}>
          <Titled icon="settings">Advanced</Titled>
        </h2>
        <p className={styles.help}>For this browser only.</p>
      </header>
      <div className={styles.setting}>
        <label htmlFor={ids.linger} className={styles.legend}>
          <Titled icon="playback">Hide the player's controls after</Titled>
        </label>
        <div className={styles.slider}>
          <input
            id={ids.linger}
            type="range"
            className={styles.range}
            min={CONTROLS_LINGER_SECONDS.min}
            max={CONTROLS_LINGER_SECONDS.max}
            step={1}
            value={lingerSeconds}
            aria-valuetext={lingerWords}
            onChange={(event) => setLingerSeconds(Number(event.target.value))}
          />
          {/* The slider's own value text says it to a screen reader. */}
          <span className={styles.sliderValue} aria-hidden="true">
            {lingerWords}
          </span>
        </div>
        <p className={styles.hint}>
          How long the controls and the cursor stay over the video once the mouse, the keys and
          clicks go quiet, from {CONTROLS_LINGER_SECONDS.min} to {CONTROLS_LINGER_SECONDS.max}{' '}
          seconds.
        </p>
      </div>
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
    case ADMIN_LOCK_STATES.on:
      return lock.available ? (
        'Turning it off asks for the admin password.'
      ) : (
        <>
          Set <code>ADMIN_PASSWORD</code> in raven's <code>.env</code> to turn it off.
        </>
      )
    case ADMIN_LOCK_STATES.turningOn:
      return (
        <>
          Turns on in <Countdown deadline={readAt + lock.remainingMs} />. Until then, turning it off
          needs no password.
        </>
      )
    case ADMIN_LOCK_STATES.off:
      return 'Off in this browser until it is turned back on, through refreshes, restarts and redeploys. Turned on, it waits a moment first, so a slip costs no password.'
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
  const isAskingNow = isAsking && current?.state === ADMIN_LOCK_STATES.on

  useEffect(() => {
    if (isAskingNow) passwordInput.current?.focus()
  }, [isAskingNow])

  const toggle = ({ from, checked }: { from: AdminLock; checked: boolean }): void => {
    switch (from.state) {
      case ADMIN_LOCK_STATES.on:
        unlock.reset()
        setAsking(!checked)
        return
      case ADMIN_LOCK_STATES.turningOn:
        if (!checked) keepOff.mutate()
        return
      case ADMIN_LOCK_STATES.off:
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
      <header className={styles.sectionHead}>
        <h2 id={headingId} className={styles.heading}>
          <Titled icon="lock">Admin</Titled>
        </h2>
        <p className={styles.help}>
          On in every browser until the admin password is entered there. While it is on, raven can
          be watched but not managed: no library is added, edited, scanned or matched, no match,
          metadata or image is changed, the settings above stay as they are, and no video is deleted
          or has its file's path shown. Locked libraries are hidden altogether, so nothing asks for
          their PIN.
        </p>
      </header>
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
      {lock.isPending && (
        <Loading label="Reading the admin lock">
          <SettingsSkeleton count={1} />
        </Loading>
      )}
      {current && (
        <label className={styles.lock}>
          <input
            type="checkbox"
            className={styles.switch}
            checked={current.state !== ADMIN_LOCK_STATES.off && !isAskingNow}
            disabled={busy || (current.state === ADMIN_LOCK_STATES.on && !current.available)}
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
            className={styles.passwordInput}
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
 * viewer, then the advanced settings and the admin lock at the foot, for
 * this browser. Each change
 * shows at once and saves on its own behind it, put back if the save
 * fails; Reset to defaults puts the server's settings back at once, after a
 * second click to be sure. With the admin lock on, the settings can be read
 * but not changed.
 */
export const SettingsPage = () => {
  const titleId = useId()
  const queryClient = useQueryClient()
  const [isConfirming, setConfirming] = useState(false)
  // Accounts show only to an approved viewer; the other states have a screen of their own.
  const access = useAccessState()
  const playback = useQuery(playbackSettingsQuery)
  const display = useQuery(displaySettingsQuery)
  const save = useOptimisticMutation({
    mutationKey: mutationKeys.playbackSettings,
    mutationFn: (change: Partial<PlaybackSettings>) => api.setPlaybackSettings(change),
    edits: (change) => [
      edit({
        queryKey: playbackSettingsQuery.queryKey,
        update: (state) => ({ ...state, settings: { ...state.settings, ...change } }),
      }),
    ],
    settle: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.playbackSettings, exact: true }),
  })
  const saveDisplay = useOptimisticMutation({
    mutationKey: mutationKeys.displaySettings,
    mutationFn: (change: Partial<DisplaySettings>) => api.setDisplaySettings(change),
    edits: (change) => [
      edit({
        queryKey: displaySettingsQuery.queryKey,
        update: (shown) => ({ ...shown, ...change }),
      }),
    ],
    settle: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.displaySettings, exact: true }),
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
        <BackButton fallback={HOME} className={styles.back} />
        <h1 id={titleId} className={styles.title}>
          Settings
        </h1>
        <AdminOnly>
          {settings &&
            (isConfirming ? (
              <div className={styles.asking}>
                <p className={styles.confirm}>Every setting goes back to its default.</p>
                <Button
                  tone="primary"
                  icon="reset"
                  className={styles.resetAll}
                  disabled={busy}
                  onClick={() => reset.mutate()}
                >
                  Reset all
                </Button>
                <Button className={styles.cancel} onClick={() => setConfirming(false)}>
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                icon="reset"
                className={styles.reset}
                disabled={busy || isAllAtDefaults}
                onClick={() => setConfirming(true)}
              >
                Reset to defaults
              </Button>
            ))}
        </AdminOnly>
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
        isResetting={reset.isPending}
        query={playback}
        shape={<SettingsSkeleton count={Object.keys(DEFAULT_PLAYBACK_SETTINGS).length} />}
        saveError={save.failure}
        browser={<BrowserPlayback />}
      >
        {({ settings: current, effective }) => (
          <>
            <Setting
              values={PLAYBACK_CHOICES.directPlay}
              icon="file-play"
              label="Play the original file"
              choices={DIRECT_PLAY}
              value={current.directPlay}
              onChange={(directPlay) => save.mutate({ directPlay })}
            />
            <Setting
              values={PLAYBACK_CHOICES.transcoding}
              icon="convert"
              label="Server conversion"
              choices={TRANSCODING}
              value={current.transcoding}
              onChange={(transcoding) => save.mutate({ transcoding })}
            />
            <Setting
              values={PLAYBACK_CHOICES.maxHeight}
              icon="resize"
              label="Transcode size"
              choices={MAX_HEIGHT}
              value={current.maxHeight}
              onChange={(maxHeight) => save.mutate({ maxHeight })}
            />
            <Setting
              values={PLAYBACK_CHOICES.quality}
              icon="gauge"
              label="Transcode quality"
              choices={QUALITY}
              value={current.quality}
              onChange={(quality) => save.mutate({ quality })}
            />
            <Setting
              values={PLAYBACK_CHOICES.hwAccel}
              icon="chip"
              label="Hardware acceleration"
              choices={HW_ACCEL}
              value={current.hwAccel}
              onChange={(hwAccel) => save.mutate({ hwAccel })}
            />
            <p className={styles.hint}>
              Transcodes encode with {ENCODER_NAMES[effective.encoder]} right now.
            </p>
            <fieldset className={styles.setting}>
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
        isResetting={reset.isPending}
        query={display}
        shape={<SettingsSkeleton count={Object.keys(DEFAULT_DISPLAY_SETTINGS).length} />}
        saveError={saveDisplay.failure}
      >
        {(shown) => (
          <Setting
            icon="film"
            label="Movie titles"
            values={DISPLAY_CHOICES.titles}
            choices={TITLES}
            value={shown.titles}
            onChange={(titles) => saveDisplay.mutate({ titles })}
          />
        )}
      </SettingsSection>
      {access.kind === ACCESS_KINDS.approved && (
        <>
          <AccountSection account={access.account} />
          {access.account.isOwner && (
            <UsersSection key={access.account.id} userId={access.account.id} />
          )}
        </>
      )}
      <AdvancedSection />
      <AdminLockSection />
    </section>
  )
}
