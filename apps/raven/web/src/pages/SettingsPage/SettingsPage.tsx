import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  DEFAULT_DISPLAY_SETTINGS,
  DEFAULT_PLAYBACK_SETTINGS,
  DISPLAY_CHOICES,
  type DisplaySettings,
  PLAYBACK_CHOICES,
  type PlaybackSettings,
} from '@raven/core'
import { type ComponentType, useId, useState } from 'react'
import { AdminOnly } from '@/components/AdminOnly/AdminOnly'
import { Button } from '@raven/ui'
import {
  AUTOPLAY_COUNTDOWN_SECONDS,
  edit,
  mutationKeys,
  queryKeys,
  useOptimisticMutation,
  usePlayerPrefs,
} from '@raven/ui/headless'
import { BackButton, HOME } from '@/components/BackButton/BackButton'
import { ACCESS_KINDS, useAccessState } from '@/lib/accessState'
import { api } from '@/lib/api'
import { MANAGEMENT_MODES, useManagement } from '@/lib/management'
import { displaySettingsQuery, playbackSettingsQuery } from '@/lib/queries'
import { DesktopSettings } from '@/desktop/settings/DesktopSettings'
import { AccountSection } from '@/pages/SettingsPage/AccountSection'
import { AdminLockSection } from '@/pages/SettingsPage/AdminLockSection'
import { AdvancedSection } from '@/pages/SettingsPage/AdvancedSection'
import {
  type Choices,
  Setting,
  SettingsSection,
  SettingsSkeleton,
} from '@/pages/SettingsPage/Setting'
import { Titled } from '@/pages/SettingsPage/Titled'
import { SETTINGS_COPY } from '@/pages/SettingsPage/copy'
import { UsersSection } from '@/pages/SettingsPage/UsersSection'
import { useIsDesktop } from '@/stores/desktop'
import { useServerReach } from '@/stores/serverReach'
import styles from '@/pages/SettingsPage/SettingsPage.module.scss'
import { PageTitle } from '@/components/PageTitle/PageTitle'
import { COMMON_COPY } from '@/lib/copy'

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

type IsAtDefaultsProps<T extends Record<string, unknown>> = {
  current: T
  defaults: T
}

/** Whether every setting in `current` is where a fresh install has it. */
const isAtDefaults = <T extends Record<string, unknown>>({
  current,
  defaults,
}: IsAtDefaultsProps<T>): boolean =>
  Object.keys(defaults).every((key) => current[key] === defaults[key])

const ENCODER_NAMES = {
  software: 'libx264 on the CPU',
  vaapi: 'VAAPI',
  videotoolbox: 'VideoToolbox',
} as const

type BrowserPlaybackProps = { isDesktop: boolean }

/**
 * Playback that this browser, or Raven, keeps for itself: autoplay and how
 * long its countdown runs, skipping intros, and in a browser Open videos in
 * Raven. That is
 * off by default: a page cannot tell whether Raven is installed, and a
 * `raven://` link nothing handles does nothing in Chrome and shows an error
 * in Safari.
 */
const BrowserPlayback = ({ isDesktop }: BrowserPlaybackProps) => {
  const countdownId = useId()
  const opensInRavenPlayer = usePlayerPrefs((prefs) => prefs.opensInRavenPlayer)
  const setOpensInRavenPlayer = usePlayerPrefs((prefs) => prefs.setOpensInRavenPlayer)
  const autoplay = usePlayerPrefs((prefs) => prefs.autoplay)
  const setAutoplay = usePlayerPrefs((prefs) => prefs.setAutoplay)
  const countdownSeconds = usePlayerPrefs((prefs) => prefs.autoplayCountdownSeconds)
  const setCountdownSeconds = usePlayerPrefs((prefs) => prefs.setAutoplayCountdownSeconds)
  const autoSkipIntro = usePlayerPrefs((prefs) => prefs.autoSkipIntro)
  const setAutoSkipIntro = usePlayerPrefs((prefs) => prefs.setAutoSkipIntro)
  const countdownWords = SETTINGS_COPY.secondsFor(countdownSeconds)
  // Headed rather than grouped: the section's groups are the server's settings.
  return (
    <section className={styles.setting}>
      <h3 className={styles.subheading}>
        <Titled icon="globe">
          {isDesktop ? SETTINGS_COPY.thisApp : SETTINGS_COPY.thisBrowser}
        </Titled>
      </h3>
      <label className={styles.choice}>
        <input
          type="checkbox"
          checked={autoplay}
          onChange={(event) => setAutoplay(event.target.checked)}
        />
        <span className={styles.choiceLabel}>{SETTINGS_COPY.autoplay}</span>
        <span className={styles.choiceHint}>{SETTINGS_COPY.autoplayHint}</span>
      </label>
      <label htmlFor={countdownId} className={styles.legend}>
        <Titled icon="playback">{SETTINGS_COPY.countdown}</Titled>
      </label>
      <div className={styles.slider}>
        <input
          id={countdownId}
          type="range"
          className={styles.range}
          min={AUTOPLAY_COUNTDOWN_SECONDS.min}
          max={AUTOPLAY_COUNTDOWN_SECONDS.max}
          step={1}
          value={countdownSeconds}
          aria-valuetext={countdownWords}
          onChange={(event) => setCountdownSeconds(Number(event.target.value))}
        />
        {/* The slider's own value text says it to a screen reader. */}
        <span className={styles.sliderValue} aria-hidden="true">
          {countdownWords}
        </span>
      </div>
      <p className={styles.hint}>
        {SETTINGS_COPY.countdownHint({
          min: AUTOPLAY_COUNTDOWN_SECONDS.min,
          max: AUTOPLAY_COUNTDOWN_SECONDS.max,
        })}
      </p>
      <label className={styles.choice}>
        <input
          type="checkbox"
          checked={autoSkipIntro}
          onChange={(event) => setAutoSkipIntro(event.target.checked)}
        />
        <span className={styles.choiceLabel}>{SETTINGS_COPY.skipIntros}</span>
        <span className={styles.choiceHint}>{SETTINGS_COPY.skipIntrosHint}</span>
      </label>
      {!isDesktop && (
        <label className={styles.choice}>
          <input
            type="checkbox"
            checked={opensInRavenPlayer}
            onChange={(event) => setOpensInRavenPlayer(event.target.checked)}
          />
          <span className={styles.choiceLabel}>{SETTINGS_COPY.openInRaven}</span>
          <span className={styles.choiceHint}>{SETTINGS_COPY.openInRavenHint}</span>
        </label>
      )}
    </section>
  )
}

type ResetControlProps = {
  isConfirming: boolean
  isBusy: boolean
  isAllAtDefaults: boolean
  onReset: () => void
  onConfirming: (isConfirming: boolean) => void
}

type ResetConfirmProps = ResetControlProps

const ResetConfirm = ({ isBusy, onReset, onConfirming }: ResetConfirmProps) => (
  <div className={styles.asking}>
    <p className={styles.confirm}>{SETTINGS_COPY.resetConfirm}</p>
    <Button
      tone="primary"
      icon="reset"
      className={styles.resetAll}
      disabled={isBusy}
      onClick={onReset}
    >
      {SETTINGS_COPY.resetAll}
    </Button>
    <Button className={styles.cancel} onClick={() => onConfirming(false)}>
      {COMMON_COPY.cancel}
    </Button>
  </div>
)

type ResetAskProps = ResetControlProps

const ResetAsk = ({ isBusy, isAllAtDefaults, onConfirming }: ResetAskProps) => (
  <Button
    icon="reset"
    className={styles.reset}
    disabled={isBusy || isAllAtDefaults}
    onClick={() => onConfirming(true)}
  >
    {SETTINGS_COPY.resetToDefaults}
  </Button>
)

const RESET_STATES = { confirming: 'confirming', idle: 'idle' } as const
type ResetState = (typeof RESET_STATES)[keyof typeof RESET_STATES]

const RESET_VIEWS = {
  [RESET_STATES.confirming]: ResetConfirm,
  [RESET_STATES.idle]: ResetAsk,
} as const satisfies Record<ResetState, ComponentType<ResetControlProps>>

/** Reset to defaults, and once clicked, the second click that makes sure. */
const ResetControl = (props: ResetControlProps) => {
  const View = RESET_VIEWS[props.isConfirming ? RESET_STATES.confirming : RESET_STATES.idle]
  return <View {...props} />
}

/**
 * Settings while Raven cannot reach its server: only what the app
 * and this browser keep for themselves.
 */
const OfflineSettings = () => {
  const titleId = useId()
  return (
    <section className={styles.page} aria-labelledby={titleId}>
      <header className={styles.header}>
        <PageTitle id={titleId} icon="settings" className={styles.title}>
          {COMMON_COPY.settings}
        </PageTitle>
      </header>
      <DesktopSettings />
      <AdvancedSection />
    </section>
  )
}

/**
 * How the server plays video, and how pages look, for every viewer, then
 * the account, Raven's own settings inside the app, and the advanced
 * settings and the admin lock at the foot, for this browser. Each change
 * shows at once and saves on its own behind it, put back if the save
 * fails; Reset to defaults puts the server's settings back at once, after a
 * second click to be sure. Where the admin lock is on, or the viewer is not
 * the owner, the settings can be read but not changed.
 */
const ServerSettings = () => {
  const titleId = useId()
  const isDesktop = useIsDesktop()
  const queryClient = useQueryClient()
  const [isConfirming, setConfirming] = useState(false)
  // Accounts show only to an approved viewer; the other states have a screen of their own.
  const access = useAccessState()
  const { mode } = useManagement()
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
        <PageTitle id={titleId} icon="settings" className={styles.title}>
          {COMMON_COPY.settings}
        </PageTitle>
        <AdminOnly>
          {settings && (
            <ResetControl
              isConfirming={isConfirming}
              isBusy={busy}
              isAllAtDefaults={isAllAtDefaults}
              onReset={() => reset.mutate()}
              onConfirming={setConfirming}
            />
          )}
        </AdminOnly>
      </header>
      <output className={styles.status}>
        {reset.isSuccess && !!settings && isAllAtDefaults ? SETTINGS_COPY.resetDone : ''}
      </output>
      {reset.isError && (
        <p className={styles.error} role="alert">
          {SETTINGS_COPY.resetFailed}
          {reset.error.message}
        </p>
      )}
      <SettingsSection
        icon="playback"
        title={SETTINGS_COPY.playback}
        hint={SETTINGS_COPY.playbackHint}
        isResetting={reset.isPending}
        query={playback}
        shape={<SettingsSkeleton count={Object.keys(DEFAULT_PLAYBACK_SETTINGS).length} />}
        saveError={save.failure}
        browser={<BrowserPlayback isDesktop={isDesktop} />}
      >
        {({ settings: current, effective }) => (
          <>
            <Setting
              values={PLAYBACK_CHOICES.directPlay}
              icon="file-play"
              label={SETTINGS_COPY.directPlay}
              choices={DIRECT_PLAY}
              value={current.directPlay}
              onChange={(directPlay) => save.mutate({ directPlay })}
            />
            <Setting
              values={PLAYBACK_CHOICES.transcoding}
              icon="convert"
              label={SETTINGS_COPY.transcoding}
              choices={TRANSCODING}
              value={current.transcoding}
              onChange={(transcoding) => save.mutate({ transcoding })}
            />
            <Setting
              values={PLAYBACK_CHOICES.maxHeight}
              icon="resize"
              label={SETTINGS_COPY.maxHeight}
              choices={MAX_HEIGHT}
              value={current.maxHeight}
              onChange={(maxHeight) => save.mutate({ maxHeight })}
            />
            <Setting
              values={PLAYBACK_CHOICES.quality}
              icon="gauge"
              label={SETTINGS_COPY.quality}
              choices={QUALITY}
              value={current.quality}
              onChange={(quality) => save.mutate({ quality })}
            />
            <Setting
              values={PLAYBACK_CHOICES.hwAccel}
              icon="chip"
              label={SETTINGS_COPY.hwAccel}
              choices={HW_ACCEL}
              value={current.hwAccel}
              onChange={(hwAccel) => save.mutate({ hwAccel })}
            />
            <p className={styles.hint}>
              {SETTINGS_COPY.encodesWith(ENCODER_NAMES[effective.encoder])}
            </p>
            <fieldset className={styles.setting}>
              <legend className={styles.legend}>
                <Titled icon="sun">{COMMON_COPY.hdr}</Titled>
              </legend>
              <label className={styles.choice}>
                <input
                  type="checkbox"
                  checked={current.tonemap}
                  onChange={(event) => save.mutate({ tonemap: event.target.checked })}
                />
                <span className={styles.choiceLabel}>{SETTINGS_COPY.tonemap}</span>
                <span className={styles.choiceHint}>
                  {effective.tonemapAvailable
                    ? SETTINGS_COPY.tonemapHint
                    : SETTINGS_COPY.tonemapUnavailable}
                </span>
              </label>
            </fieldset>
            <fieldset className={styles.setting}>
              <legend className={styles.legend}>
                <Titled icon="skipNext">{SETTINGS_COPY.markers}</Titled>
              </legend>
              <label className={styles.choice}>
                <input
                  type="checkbox"
                  checked={current.detectMarkers}
                  onChange={(event) => save.mutate({ detectMarkers: event.target.checked })}
                />
                <span className={styles.choiceLabel}>{SETTINGS_COPY.detectMarkers}</span>
                <span className={styles.choiceHint}>{SETTINGS_COPY.detectMarkersHint}</span>
              </label>
            </fieldset>
          </>
        )}
      </SettingsSection>
      <SettingsSection
        icon="image"
        title={SETTINGS_COPY.display}
        hint={SETTINGS_COPY.displayHint}
        isResetting={reset.isPending}
        query={display}
        shape={<SettingsSkeleton count={Object.keys(DEFAULT_DISPLAY_SETTINGS).length} />}
        saveError={saveDisplay.failure}
      >
        {(shown) => (
          <Setting
            icon="film"
            label={SETTINGS_COPY.movieTitles}
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
      {isDesktop && <DesktopSettings />}
      <AdvancedSection />
      {mode === MANAGEMENT_MODES.adminLock && <AdminLockSection />}
    </section>
  )
}

const REACH_STATES = { offline: 'offline', online: 'online' } as const
type ReachState = (typeof REACH_STATES)[keyof typeof REACH_STATES]

const SETTINGS_VIEWS = {
  [REACH_STATES.offline]: OfflineSettings,
  [REACH_STATES.online]: ServerSettings,
} as const satisfies Record<ReachState, ComponentType>

/**
 * `/settings`: the server's settings and this browser's, or inside raven
 * player while its server is out of reach, only the app's own.
 */
export const SettingsPage = () => {
  const isOffline = useServerReach((state) => state.isOffline)
  const View = SETTINGS_VIEWS[isOffline ? REACH_STATES.offline : REACH_STATES.online]
  return <View />
}
