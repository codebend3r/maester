import {
  DESKTOP_EVENTS,
  DESKTOP_PLATFORMS,
  type DesktopEvent,
  type DesktopPlatform,
  MENU_PLAYER_ACTIONS,
  type MenuPlayerAction,
  PAGE_PATHS,
} from '@raven/core'
import type { MenuItemConstructorOptions } from 'electron'

type MenuActions = {
  openDialog: () => void
  send: (event: DesktopEvent) => void
  toggleDevTools: () => void
  showLogs: () => void
  showCrashReports: () => void
  copyDiagnostics: () => void
  checkForUpdates: () => void
}

/**
 * Electron's item with a click that needs none of its arguments, so the template
 * can be clicked in tests; it is still a `MenuItemConstructorOptions`.
 */
export type MenuEntry = Omit<MenuItemConstructorOptions, 'click' | 'submenu'> & {
  click?: () => void
  submenu?: MenuEntry[]
}

const SEPARATOR = { type: 'separator' } as const satisfies MenuEntry

const PLAYBACK = [
  { label: 'Play or Pause', action: MENU_PLAYER_ACTIONS.togglePlay },
  { label: 'Skip Back', action: MENU_PLAYER_ACTIONS.skipBack },
  { label: 'Skip Forward', action: MENU_PLAYER_ACTIONS.skipForward },
  { label: 'Next', action: MENU_PLAYER_ACTIONS.next },
  { label: 'Video Info', action: MENU_PLAYER_ACTIONS.stats },
] as const satisfies readonly { label: string; action: MenuPlayerAction }[]

type MenuTemplateProps = {
  appName: string
  isDevelopment: boolean
  platform: DesktopPlatform
  actions: MenuActions
}

type AppMenusProps = Pick<MenuTemplateProps, 'appName' | 'platform' | 'actions'>

/**
 * The app's own items and the File menu. macOS puts the app's items in a menu of its own,
 * with the hide roles and the recent documents it alone keeps; Windows has no app menu, so
 * they end the File menu there.
 */
const appMenus = ({ appName, platform, actions }: AppMenusProps): MenuEntry[] => {
  const open = {
    label: 'Open…',
    accelerator: 'CommandOrControl+O',
    click: actions.openDialog,
  } as const satisfies MenuEntry
  const openLink = {
    label: 'Open Link…',
    accelerator: 'CommandOrControl+L',
    click: () => actions.send({ type: DESKTOP_EVENTS.openLink }),
  } as const satisfies MenuEntry
  const settings = {
    label: 'Settings…',
    accelerator: 'CommandOrControl+,',
    click: () => actions.send({ type: DESKTOP_EVENTS.navigate, to: PAGE_PATHS.settings }),
  } as const satisfies MenuEntry
  const checkForUpdates = {
    label: 'Check for Updates…',
    id: 'check-for-updates',
    click: actions.checkForUpdates,
  } as const satisfies MenuEntry

  switch (platform) {
    case DESKTOP_PLATFORMS.mac:
      return [
        {
          label: appName,
          submenu: [
            { role: 'about' },
            SEPARATOR,
            settings,
            checkForUpdates,
            SEPARATOR,
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            SEPARATOR,
            { role: 'quit' },
          ],
        },
        {
          label: 'File',
          submenu: [
            open,
            // macOS keeps this list, fed by `app.addRecentDocument`; choosing one fires `open-file`.
            {
              label: 'Open Recent',
              role: 'recentDocuments',
              submenu: [{ role: 'clearRecentDocuments' }],
            },
            openLink,
            SEPARATOR,
            { role: 'close' },
          ],
        },
      ]
    case DESKTOP_PLATFORMS.windows:
      return [
        {
          label: 'File',
          submenu: [
            open,
            openLink,
            SEPARATOR,
            settings,
            checkForUpdates,
            SEPARATOR,
            { role: 'close' },
            { role: 'quit' },
          ],
        },
      ]
    default: {
      const unreachable: never = platform
      return unreachable
    }
  }
}

/**
 * The menus from the spec's "Menus" table. Every accelerator holds a modifier:
 * single keys stay with the page, or a menu would take Space and the arrows from
 * the PIN field and the volume slider.
 */
export const menuTemplate = ({
  appName,
  isDevelopment,
  platform,
  actions,
}: MenuTemplateProps): MenuEntry[] => {
  const player = (action: MenuPlayerAction) => () =>
    actions.send({ type: DESKTOP_EVENTS.player, action })

  return [
    ...appMenus({ appName, platform, actions }),
    {
      label: 'Playback',
      submenu: PLAYBACK.map(({ label, action }) => ({ label, click: player(action) })),
    },
    {
      label: 'View',
      submenu: [
        { role: 'togglefullscreen' },
        ...(isDevelopment
          ? [
              SEPARATOR,
              {
                label: 'Toggle Developer Tools',
                accelerator: 'Alt+CommandOrControl+I',
                click: actions.toggleDevTools,
              },
            ]
          : []),
      ],
    },
    { label: 'Window', role: 'windowMenu' },
    {
      label: 'Help',
      role: 'help',
      submenu: [
        { label: 'Keyboard Shortcuts', click: player('showShortcuts') },
        SEPARATOR,
        { label: 'Show Logs', id: 'show-logs', click: actions.showLogs },
        { label: 'Show Crash Reports', id: 'show-crash-reports', click: actions.showCrashReports },
        { label: 'Copy Diagnostics', id: 'copy-diagnostics', click: actions.copyDiagnostics },
      ],
    },
  ]
}
