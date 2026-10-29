import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  DEFAULT_DISPLAY_SETTINGS,
  DEFAULT_PLAYBACK_SETTINGS,
  DISPLAY_CHOICES,
  type DisplaySettings,
  PLAYBACK_CHOICES,
  type PlaybackSettings,
} from '@raven/core'
import { useId, useState } from 'react'
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
import { UsersSection } from '@/pages/SettingsPage/UsersSection'
import { useIsDesktop } from '@/stores/desktop'
import { useServerReach } from '@/stores/serverReach'
import styles from '@/pages/SettingsPage/SettingsPage.module.scss'

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
}

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
  const countdownWords = `${countdownSeconds} seconds`
  // Headed rather than grouped: the section's groups are the server's settings.
  return (
    <section className={styles.setting}>
      <h3 className={styles.subheading}>
        <Titled icon="globe">{isDesktop ? 'This app' : 'This browser'}</Titled>
      </h3>
      <label className={styles.choice}>
        <input
          type="checkbox"
          checked={autoplay}
          onChange={(event) => setAutoplay(event.target.checked)}
        />
        <span className={styles.choiceLabel}>Autoplay</span>
        <span className={styles.choiceHint}>
          Plays the next episode, the saga's next film or the shuffle's next pick once the countdown
          at the end runs out. Off, the up next card waits for Play now.
        </span>
      </label>
      <label htmlFor={countdownId} className={styles.legend}>
        <Titled icon="playback">Count down to what is up next for</Titled>
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
        How long before the end the up next card shows, and with autoplay on how long it counts
        down, from {AUTOPLAY_COUNTDOWN_SECONDS.min} to {AUTOPLAY_COUNTDOWN_SECONDS.max} seconds.
      </p>
      <label className={styles.choice}>
        <input
          type="checkbox"
          checked={autoSkipIntro}
          onChange={(event) => setAutoSkipIntro(event.target.checked)}
        />
        <span className={styles.choiceLabel}>Skip intros automatically</span>
        <span className={styles.choiceHint}>
          Jumps past an intro the file's chapters mark, once per episode, with a moment to undo it.
          Off, Skip intro waits for a click.
        </span>
      </label>
      {!isDesktop && (
        <label className={styles.choice}>
          <input
            type="checkbox"
            checked={opensInRavenPlayer}
            onChange={(event) => setOpensInRavenPlayer(event.target.checked)}
          />
          <span className={styles.choiceLabel}>Open videos in Raven</span>
          <span className={styles.choiceHint}>
            Offers Raven for videos this browser cannot play, in the player's settings, and Download
            to Raven on a title's page. Turn it on only where Raven is installed.
          </span>
        </label>
      )}
    </section>
  )
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
        <h1 id={titleId} className={styles.title}>
          Settings
        </h1>
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
        browser={<BrowserPlayback isDesktop={isDesktop} />}
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
      {isDesktop && <DesktopSettings />}
      <AdvancedSection />
      {mode === MANAGEMENT_MODES.adminLock && <AdminLockSection />}
    </section>
  )
}

/**
 * `/settings`: the server's settings and this browser's, or inside raven
 * player while its server is out of reach, only the app's own.
 */
export const SettingsPage = () =>
  useServerReach((state) => state.isOffline) ? <OfflineSettings /> : <ServerSettings />
