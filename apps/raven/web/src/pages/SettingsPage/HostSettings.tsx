import type { ComponentType } from 'react'
import { DesktopSettings } from '@/desktop/settings/DesktopSettings'
import { DownloadsSection } from '@/desktop/settings/DownloadsSection'
import { DOWNLOADS_HOSTS } from '@/downloads/host'
import { useDownloadsHostOrNone } from '@/stores/downloadsHost'

/** Who keeps the page's downloads, or nobody: a browser that cannot. */
const SETTINGS_HOSTS = { ...DOWNLOADS_HOSTS, none: 'none' } as const

type SettingsHost = (typeof SETTINGS_HOSTS)[keyof typeof SETTINGS_HOSTS]

const NoHostSettings = () => null

/** Raven's own sections; a browser that keeps downloads has the Downloads one alone. */
const HOST_SETTINGS = {
  [SETTINGS_HOSTS.desktop]: DesktopSettings,
  [SETTINGS_HOSTS.browser]: DownloadsSection,
  [SETTINGS_HOSTS.none]: NoHostSettings,
} as const satisfies Record<SettingsHost, ComponentType>

/** What Settings shows of the downloads host: needs no server, so it stays while one is out of reach. */
export const HostSettings = () => {
  const host = useDownloadsHostOrNone()
  const View = HOST_SETTINGS[host?.kind ?? SETTINGS_HOSTS.none]
  return <View />
}
