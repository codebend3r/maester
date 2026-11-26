import { myRequestCountOf } from '@raven/core'
import { KeyedView, type TabEntry, type ViewOf, type ViewsOf } from '@raven/ui/headless'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { type ComponentType, type ReactNode, useState } from 'react'

import { useOwnerId } from '@/account/useOwnerId'
import { SettingsPage, SettingsTabs } from '@/layouts'
import { type AppQueries, useAppQueries } from '@/queries/useAppQueries'
import { AdminSettings } from '@/screens/AdminSettings'
import {
  AccountPanel,
  AdvancedPanel,
  PlaybackPanel,
  RequestsPanel,
  SubtitlesPanel,
  ThisAppPanel,
} from '@/screens/SettingsPanels'
import { ServerSettings } from '@/screens/ServerSettings'
import { SETTINGS_COPY } from '@/screens/copy'

/** Settings' tabs, each a group of related settings, the owner's Admin last. */
const SETTINGS_TABS = {
  playback: 'playback',
  subtitles: 'subtitles',
  servers: 'servers',
  account: 'account',
  thisApp: 'thisApp',
  advanced: 'advanced',
  requests: 'requests',
  admin: 'admin',
} as const

type SettingsTabKey = (typeof SETTINGS_TABS)[keyof typeof SETTINGS_TABS]

/** A tab and the settings it opens on. */
type PanelTab = { tab: TabEntry<SettingsTabKey>; panel: ReactNode }

/** The tabs every device has, server or none, in their order. */
const DEVICE_PANELS = [
  [SETTINGS_TABS.playback, SETTINGS_COPY.tabs.playback, PlaybackPanel],
  [SETTINGS_TABS.subtitles, SETTINGS_COPY.tabs.subtitles, SubtitlesPanel],
  [SETTINGS_TABS.servers, SETTINGS_COPY.tabs.servers, ServerSettings],
  [SETTINGS_TABS.account, SETTINGS_COPY.tabs.account, AccountPanel],
  [SETTINGS_TABS.thisApp, SETTINGS_COPY.tabs.thisApp, ThisAppPanel],
  [SETTINGS_TABS.advanced, SETTINGS_COPY.tabs.advanced, AdvancedPanel],
] as const satisfies readonly (readonly [SettingsTabKey, string, ComponentType])[]

type DevicePanel = (typeof DEVICE_PANELS)[number]

const panelTabOf = ([value, label, Panel]: DevicePanel): PanelTab => ({
  tab: { value, label },
  panel: <Panel />,
})

/** Playback, which Settings opens on and falls back to. */
const FIRST_TAB = panelTabOf(DEVICE_PANELS[0])

const DEVICE_TABS: readonly PanelTab[] = DEVICE_PANELS.map(panelTabOf)

type SettingsViewProps = {
  /** The tabs only a server gives, after the device's own. */
  serverTabs: readonly PanelTab[]
}

/** The page: the title, the tabs, and the chosen tab's settings, which last while the page is open. */
const SettingsView = ({ serverTabs }: SettingsViewProps) => {
  const router = useRouter()
  const [asked, setAsked] = useState<SettingsTabKey>(SETTINGS_TABS.playback)
  const shown = [...DEVICE_TABS, ...serverTabs]
  // A tab that has gone (Admin, once the account is no longer the owner's) gives way to the first.
  const chosen = shown.find(({ tab }) => tab.value === asked) ?? FIRST_TAB
  return (
    <SettingsPage onBack={() => router.back()} title={SETTINGS_COPY.title}>
      <SettingsTabs
        chosen={chosen.tab.value}
        label={SETTINGS_COPY.tabs.label}
        onChoose={setAsked}
        tabs={shown.map(({ tab }) => tab)}
      />
      {chosen.panel}
    </SettingsPage>
  )
}

type ServerSettingsViewProps = { session: AppQueries }

/** With a server: the caller's Requests, with how many they made once read, and Admin for the approved owner alone. */
const ServerSettingsView = ({ session }: ServerSettingsViewProps) => {
  const ownerId = useOwnerId(session)
  const { data: requests } = useQuery(session.queries.requestsQuery)
  const requestsTab: PanelTab = {
    tab: {
      value: SETTINGS_TABS.requests,
      label: SETTINGS_COPY.tabs.requests,
      count: myRequestCountOf(requests),
    },
    panel: <RequestsPanel session={session} />,
  }
  const adminTabs: PanelTab[] =
    ownerId === null
      ? []
      : [
          {
            tab: { value: SETTINGS_TABS.admin, label: SETTINGS_COPY.tabs.admin },
            panel: <AdminSettings ownerId={ownerId} session={session} />,
          },
        ]
  return <SettingsView serverTabs={[requestsTab, ...adminTabs]} />
}

const DeviceSettingsView = () => <SettingsView serverTabs={[]} />

/** Whether Settings has a server to read, which gives it the server's tabs. */
const SETTINGS_SOURCES = { device: 'device', server: 'server' } as const

type SettingsSourceProps = {
  [SETTINGS_SOURCES.device]: Record<string, never>
  [SETTINGS_SOURCES.server]: ServerSettingsViewProps
}

const SETTINGS_VIEWS = {
  [SETTINGS_SOURCES.device]: DeviceSettingsView,
  [SETTINGS_SOURCES.server]: ServerSettingsView,
} as const satisfies ViewsOf<SettingsSourceProps>

const settingsViewOf = (session: AppQueries | null): ViewOf<SettingsSourceProps> =>
  session === null
    ? { key: SETTINGS_SOURCES.device, props: {} }
    : { key: SETTINGS_SOURCES.server, props: { session } }

/** `/settings`: the web's Settings, in its tabs. */
export const Settings = () => (
  <KeyedView<SettingsSourceProps> views={SETTINGS_VIEWS} view={settingsViewOf(useAppQueries())} />
)
