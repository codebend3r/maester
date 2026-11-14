import { useQuery } from '@tanstack/react-query'
import { type ComponentType, useId, useState } from 'react'
import { AUTOPLAY_COUNTDOWN_SECONDS, usePlayerPrefs } from '@raven/ui/headless'
import { BackButton, HOME } from '@/components/BackButton/BackButton'
import { Tabs } from '@/components/Tabs/Tabs'
import { ACCESS_KINDS, useAccessState } from '@/lib/accessState'
import { requestsQuery } from '@/lib/queries'
import { AccountSection } from '@/pages/SettingsPage/AccountSection'
import { AdvancedSection } from '@/pages/SettingsPage/AdvancedSection'
import { CaptionSettings } from '@/pages/SettingsPage/CaptionSettings'
import { mineOf, RequestsTab } from '@/pages/SettingsPage/RequestsTab'
import { ScrobblingSection } from '@/pages/SettingsPage/ScrobblingSection'
import { SoundSettings } from '@/pages/SettingsPage/SoundSettings'
import { Titled } from '@/pages/SettingsPage/Titled'
import { SETTINGS_COPY } from '@/pages/SettingsPage/copy'
import { HostSettings } from '@/pages/SettingsPage/HostSettings'
import { useIsDesktop } from '@/stores/desktop'
import { useServerReach } from '@/stores/serverReach'
import styles from '@/pages/SettingsPage/SettingsPage.module.scss'
import { PageTitle } from '@/components/PageTitle/PageTitle'
import { COMMON_COPY } from '@/lib/copy'
import { ToggleChoice } from '@/pages/SettingsPage/ToggleChoice'

type BrowserPlaybackProps = { isDesktop: boolean }

/**
 * Playback that this browser, or Raven, keeps for itself: autoplay and how
 * long its countdown runs, skipping intros, in a browser Open videos in
 * Raven, and how music sounds. Open videos in Raven is
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
      <ToggleChoice
        label={SETTINGS_COPY.autoplay}
        hint={SETTINGS_COPY.autoplayHint}
        isChecked={autoplay}
        onChange={setAutoplay}
      />
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
      <ToggleChoice
        label={SETTINGS_COPY.skipIntros}
        hint={SETTINGS_COPY.skipIntrosHint}
        isChecked={autoSkipIntro}
        onChange={setAutoSkipIntro}
      />
      {!isDesktop && (
        <ToggleChoice
          label={SETTINGS_COPY.openInRaven}
          hint={SETTINGS_COPY.openInRavenHint}
          isChecked={opensInRavenPlayer}
          onChange={setOpensInRavenPlayer}
        />
      )}
      <SoundSettings isDesktop={isDesktop} />
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
        <PageTitle id={titleId} icon="settings" className={styles.title}>
          {COMMON_COPY.settings}
        </PageTitle>
      </header>
      <HostSettings />
      <AdvancedSection />
    </section>
  )
}

/** The viewer's own preferences: playback, the account, scrobbling, this host and the advanced. */
const ViewerPreferences = () => {
  const isDesktop = useIsDesktop()
  const access = useAccessState()
  return (
    <div className={styles.panel}>
      <section className={styles.section} aria-label={SETTINGS_COPY.playback}>
        <h2 className={styles.heading}>{SETTINGS_COPY.playback}</h2>
        <CaptionSettings />
        <BrowserPlayback isDesktop={isDesktop} />
      </section>
      {access.kind === ACCESS_KINDS.approved && <AccountSection account={access.account} />}
      {(access.kind === ACCESS_KINDS.approved || access.kind === ACCESS_KINDS.disabled) && (
        <ScrobblingSection />
      )}
      <HostSettings />
      <AdvancedSection />
    </div>
  )
}

/** Settings' tabs: the viewer's preferences, and the titles they asked Coming soon for. */
const SETTINGS_TABS = { preferences: 'preferences', requests: 'requests' } as const
type SettingsTab = (typeof SETTINGS_TABS)[keyof typeof SETTINGS_TABS]

const SETTINGS_PANELS = {
  [SETTINGS_TABS.preferences]: ViewerPreferences,
  [SETTINGS_TABS.requests]: RequestsTab,
} as const satisfies Record<SettingsTab, ComponentType>

const ViewerSettings = () => {
  const titleId = useId()
  const [tab, setTab] = useState<SettingsTab>(SETTINGS_TABS.preferences)
  const { data: requests } = useQuery(requestsQuery)
  const Panel = SETTINGS_PANELS[tab]
  return (
    <section className={styles.page} aria-labelledby={titleId}>
      <header className={styles.header}>
        <BackButton fallback={HOME} className={styles.back} />
        <PageTitle id={titleId} icon="settings" className={styles.title}>
          {COMMON_COPY.settings}
        </PageTitle>
      </header>
      <Tabs
        label={SETTINGS_COPY.tabs.label}
        tabs={[
          { value: SETTINGS_TABS.preferences, label: SETTINGS_COPY.tabs.preferences },
          {
            value: SETTINGS_TABS.requests,
            label: SETTINGS_COPY.tabs.requests,
            ...(requests === undefined ? {} : { count: mineOf(requests).length }),
          },
        ]}
        chosen={tab}
        onChoose={setTab}
      >
        <Panel />
      </Tabs>
    </section>
  )
}

const REACH_STATES = { offline: 'offline', online: 'online' } as const
type ReachState = (typeof REACH_STATES)[keyof typeof REACH_STATES]

const SETTINGS_VIEWS = {
  [REACH_STATES.offline]: OfflineSettings,
  [REACH_STATES.online]: ViewerSettings,
} as const satisfies Record<ReachState, ComponentType>

/**
 * Personal preferences and account settings, never server administration.
 */
export const SettingsPage = () => {
  const isOffline = useServerReach((state) => state.isOffline)
  const View = SETTINGS_VIEWS[isOffline ? REACH_STATES.offline : REACH_STATES.online]
  return <View />
}
