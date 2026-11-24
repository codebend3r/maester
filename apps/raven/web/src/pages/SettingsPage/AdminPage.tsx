import { type ComponentType, useId, useState } from 'react'
import { BUTTON_TONES, Button } from '@raven/ui'
import { useServerSettingsSaves } from '@raven/ui/headless'
import { BackButton, HOME } from '@/components/BackButton/BackButton'
import { PageTitle } from '@/components/PageTitle/PageTitle'
import { Tabs } from '@/components/Tabs/Tabs'
import { ACCESS_KINDS, useAccessState } from '@/lib/accessState'
import { api } from '@/lib/api'
import { COMMON_COPY } from '@/lib/copy'
import { MANAGEMENT_MODES, useManagement } from '@/lib/management'
import { displaySettingsQuery, playbackSettingsQuery } from '@/lib/queries'
import { useAddressValue } from '@/lib/useAddressValue'
import { ADMIN_COPY } from '@/pages/SettingsPage/adminCopy'
import { AdminLockSection } from '@/pages/SettingsPage/AdminLockSection'
import { type AdminPanelProps, AdminPlaybackPanel } from '@/pages/SettingsPage/AdminPlaybackPanel'
import { SETTINGS_COPY } from '@/pages/SettingsPage/copy'
import { RemoteAccessSection } from '@/pages/SettingsPage/RemoteAccessSection'
import { ScanSwitch } from '@/pages/SettingsPage/ScanSwitch'
import styles from '@/pages/SettingsPage/SettingsPage.module.scss'
import { UsersSection } from '@/pages/SettingsPage/UsersSection'

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
      tone={BUTTON_TONES.primary}
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

/** Admin's second tab: the scans running across the server's libraries. */
const ServerPanel = () => <ScanSwitch />

/** Admin's third tab: who reaches raven and how. Remote access, the accounts for their owner, and the admin lock where it is what guards managing. */
const AccessPanel = () => {
  // Accounts show only to an approved viewer; the other states have a screen of their own.
  const access = useAccessState()
  const { mode } = useManagement()
  return (
    <>
      <RemoteAccessSection />
      {access.kind === ACCESS_KINDS.approved && access.account.isOwner && (
        <UsersSection key={access.account.id} userId={access.account.id} />
      )}
      {mode === MANAGEMENT_MODES.adminLock && <AdminLockSection />}
    </>
  )
}

/** Admin's tabs, each a group of settings that belong together; the address names any but the first, so a reload keeps it. */
const ADMIN_TABS = { playback: 'playback', server: 'server', access: 'access' } as const

type AdminTab = (typeof ADMIN_TABS)[keyof typeof ADMIN_TABS]

const ADMIN_TAB_VALUES = Object.values(ADMIN_TABS)

const isAdminTab = (value: string | null): value is AdminTab =>
  ADMIN_TAB_VALUES.some((tab) => tab === value)

/** The address's search param that names the tab shown. */
const ADMIN_SEARCH = { tab: 'tab' } as const

const ADMIN_PANELS = {
  [ADMIN_TABS.playback]: AdminPlaybackPanel,
  [ADMIN_TABS.server]: ServerPanel,
  [ADMIN_TABS.access]: AccessPanel,
} as const satisfies Record<AdminTab, ComponentType<AdminPanelProps>>

/**
 * Server-wide settings and management, mounted only for an authorized admin,
 * grouped into tabs: playback and display, the server and its scans, and who
 * has access. Changes save optimistically; Reset asks for confirmation
 * before restoring the playback and display defaults.
 */
const ServerSettings = () => {
  const titleId = useId()
  const [isConfirming, setConfirming] = useState(false)
  const [asked, setAsked] = useAddressValue(ADMIN_SEARCH.tab)
  const tab = isAdminTab(asked) ? asked : ADMIN_TABS.playback
  const Panel = ADMIN_PANELS[tab]
  const saves = useServerSettingsSaves({
    api,
    queries: { playbackSettingsQuery, displaySettingsQuery },
    onReset: () => setConfirming(false),
  })
  const { playback, reset, isBusy, isAllAtDefaults } = saves
  const hasSettings = playback.data !== undefined

  return (
    <section className={styles.page} aria-labelledby={titleId}>
      <header className={styles.header}>
        <BackButton fallback={HOME} className={styles.back} />
        <PageTitle id={titleId} icon="settings" className={styles.title}>
          {ADMIN_COPY.heading}
        </PageTitle>
        {hasSettings && (
          <ResetControl
            isConfirming={isConfirming}
            isBusy={isBusy}
            isAllAtDefaults={isAllAtDefaults}
            onReset={() => reset.mutate()}
            onConfirming={setConfirming}
          />
        )}
      </header>
      <output className={styles.status}>
        {reset.isSuccess && hasSettings && isAllAtDefaults ? SETTINGS_COPY.resetDone : ''}
      </output>
      {reset.isError && (
        <p className={styles.error} role="alert">
          {SETTINGS_COPY.resetFailed}
          {reset.error.message}
        </p>
      )}
      <Tabs
        label={ADMIN_COPY.tabs.label}
        tabs={ADMIN_TAB_VALUES.map((value) => ({ value, label: ADMIN_COPY.tabs[value] }))}
        chosen={tab}
        onChoose={(next) => setAsked(next === ADMIN_TABS.playback ? null : next)}
      >
        <div className={styles.panel}>
          <Panel saves={saves} />
        </div>
      </Tabs>
    </section>
  )
}

export const AdminPage = () => {
  const { mode, canManage } = useManagement()
  return (
    <>
      {canManage && <ServerSettings />}
      {!canManage && mode === MANAGEMENT_MODES.adminLock && <AdminLockSection />}
    </>
  )
}
