import { DESKTOP_PLATFORMS, type DesktopPlatform } from '@raven/core'

/** The environment variables a Raven build reads. */
export const DESKTOP_ENV = {
  /** The server `/api` goes to, an http or https origin with no path. */
  serverOrigin: 'RAVEN_DESKTOP_SERVER_ORIGIN',
  /** Comma separated origins whose `raven://` links name the same server. */
  linkOrigins: 'RAVEN_DESKTOP_LINK_ORIGINS',
} as const

/** Node's name for Windows. */
const WINDOWS_PLATFORM = 'win32'

type DesktopPlatformForProps = {
  /** Node's `process.platform`. */
  platform: string
}

/** The system a Raven process runs on, from Node's name for it. */
export const desktopPlatformFor = ({ platform }: DesktopPlatformForProps): DesktopPlatform =>
  platform === WINDOWS_PLATFORM ? DESKTOP_PLATFORMS.windows : DESKTOP_PLATFORMS.mac

/** What logs and diagnostics call the system, before its version. */
export const SYSTEM_NAMES = {
  [DESKTOP_PLATFORMS.mac]: 'macOS',
  [DESKTOP_PLATFORMS.windows]: 'Windows',
} as const satisfies Record<DesktopPlatform, string>
