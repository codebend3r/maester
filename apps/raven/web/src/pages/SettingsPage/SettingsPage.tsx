import { myRequestCountOf } from '@raven/core'
import { useQuery } from '@tanstack/react-query'
import { type ComponentType, useId } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AUTOPLAY_COUNTDOWN_SECONDS, usePlayerPrefs } from '@raven/ui/headless'
import { BackButton, HOME } from '@/components/BackButton/BackButton'
import { Tabs } from '@/components/Tabs/Tabs'
import { ACCESS_KINDS, type AccessState, useAccessState } from '@/lib/accessState'
import { requestsQuery } from '@/lib/queries'
import { AccountSection } from '@/pages/SettingsPage/AccountSection'
import { AdvancedSection } from '@/pages/SettingsPage/AdvancedSection'
import { CaptionSettings } from '@/pages/SettingsPage/CaptionSettings'
import { RequestsTab } from '@/pages/SettingsPage/RequestsTab'
import { ScrobblingSection } from '@/pages/SettingsPage/ScrobblingSection'
import { ServerSection } from '@/pages/SettingsPage/ServerSection'
import { SoundSettings } from '@/pages/SettingsPage/SoundSettings'
import { Titled } from '@/pages/SettingsPage/Titled'
import { SETTINGS_COPY } from '@/pages/SettingsPage/copy'
import { HostSettings } from '@/pages/SettingsPage/HostSettings'
import { useIsDesktop } from '@/stores/desktop'
import { useDownloadsHostOrNone } from '@/stores/downloadsHost'
import { useServerReach } from '@/stores/serverReach'
import styles from '@/pages/SettingsPage/SettingsPage.module.scss'
import { PageTitle } from '@/components/PageTitle/PageTitle'
import { COMMON_COPY } from '@/lib/copy'
import { ToggleChoice } from '@/pages/SettingsPage/ToggleChoice'

type BrowserPlaybackProps = { isDesktop: boolean }

/**
 * Playback that this browser, or Raven, keeps for itself: autoplay and how
 * long its countdown runs, skipping intros, and in a browser Open videos in
 * Raven. Open videos in Raven is
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
    </section>
  )
}

/**
 * Settings while the server cannot be reached: what the app and this
 * browser keep for themselves, and the servers, so another one can be
 * switched to.
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
      <ServerSection />
      <HostSettings />
      <AdvancedSection />
    </section>
  )
}

type PanelProps = { access: AccessState; isDesktop: boolean }

/** The account, for an approved one, and its scrobbling, which a server without accounts keeps too. */
const AccountPanel = ({ access }: PanelProps) => (
  <>
    {access.kind === ACCESS_KINDS.approved && <AccountSection account={access.account} />}
    <ScrobblingSection />
  </>
)

/** Settings' tabs, each a group of related settings, and the titles asked Coming soon for. */
const SETTINGS_TABS = {
  playback: 'playback',
  subtitles: 'subtitles',
  audio: 'audio',
  servers: 'servers',
  account: 'account',
  host: 'host',
  advanced: 'advanced',
  requests: 'requests',
} as const

type SettingsTab = (typeof SETTINGS_TABS)[keyof typeof SETTINGS_TABS]

/** The address's key for the tab open, so a reload or a link opens the same one. */
const SETTINGS_TAB_PARAM = 'tab'

const SETTINGS_PANELS = {
  [SETTINGS_TABS.playback]: BrowserPlayback,
  [SETTINGS_TABS.subtitles]: CaptionSettings,
  [SETTINGS_TABS.audio]: SoundSettings,
  [SETTINGS_TABS.servers]: ServerSection,
  [SETTINGS_TABS.account]: AccountPanel,
  [SETTINGS_TABS.host]: HostSettings,
  [SETTINGS_TABS.advanced]: AdvancedSection,
  [SETTINGS_TABS.requests]: RequestsTab,
} as const satisfies Record<SettingsTab, ComponentType<PanelProps>>

const isSettingsTab = (value: unknown): value is SettingsTab =>
  Object.values(SETTINGS_TABS).some((tab) => tab === value)

type TabsShownProps = {
  access: AccessState
  hasHost: boolean
  isDesktop: boolean
  requestCount: number | undefined
}

/**
 * The tabs this viewer has: Account while there is an account or scrobbling to show, and the
 * downloads host's own (Raven's sections, or a browser's Downloads) where there is one.
 */
const tabsShown = ({ access, hasHost, isDesktop, requestCount }: TabsShownProps) => {
  const hasAccount = access.kind === ACCESS_KINDS.approved || access.kind === ACCESS_KINDS.disabled
  const copy = SETTINGS_COPY.tabs
  const hostLabel = isDesktop ? copy.thisApp : copy.downloads
  return [
    { value: SETTINGS_TABS.playback, label: copy.playback },
    { value: SETTINGS_TABS.subtitles, label: copy.subtitles },
    { value: SETTINGS_TABS.audio, label: copy.audio },
    { value: SETTINGS_TABS.servers, label: copy.servers },
    ...(hasAccount ? [{ value: SETTINGS_TABS.account, label: copy.account }] : []),
    ...(hasHost ? [{ value: SETTINGS_TABS.host, label: hostLabel }] : []),
    { value: SETTINGS_TABS.advanced, label: copy.advanced },
    {
      value: SETTINGS_TABS.requests,
      label: copy.requests,
      ...(requestCount === undefined ? {} : { count: requestCount }),
    },
  ]
}

const ViewerSettings = () => {
  const titleId = useId()
  const isDesktop = useIsDesktop()
  const access = useAccessState()
  const hasHost = useDownloadsHostOrNone() !== null
  const [params, setParams] = useSearchParams()
  const { data: requests } = useQuery(requestsQuery)
  const tabs = tabsShown({
    access,
    hasHost,
    isDesktop,
    requestCount: myRequestCountOf(requests),
  })
  const asked = params.get(SETTINGS_TAB_PARAM)
  const tab =
    tabs.find((shown) => isSettingsTab(asked) && shown.value === asked)?.value ??
    SETTINGS_TABS.playback
  const choose = (chosen: SettingsTab) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current)
        next.set(SETTINGS_TAB_PARAM, chosen)
        return next
      },
      { replace: true },
    )
  const Panel = SETTINGS_PANELS[tab]
  return (
    <section className={styles.page} aria-labelledby={titleId}>
      <header className={styles.header}>
        <BackButton fallback={HOME} className={styles.back} />
        <PageTitle id={titleId} icon="settings" className={styles.title}>
          {COMMON_COPY.settings}
        </PageTitle>
      </header>
      <Tabs label={SETTINGS_COPY.tabs.label} tabs={tabs} chosen={tab} onChoose={choose}>
        <div className={styles.panel}>
          <Panel access={access} isDesktop={isDesktop} />
        </div>
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

/** Personal preferences and account settings, never server administration. */
export const SettingsPage = () => {
  const isOffline = useServerReach((state) => state.isOffline)
  const View = SETTINGS_VIEWS[isOffline ? REACH_STATES.offline : REACH_STATES.online]
  return <View />
}
