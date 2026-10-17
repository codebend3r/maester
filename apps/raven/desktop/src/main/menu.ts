import type { MenuItemConstructorOptions } from 'electron'
import type { DesktopEvent, MenuPlayerAction } from '@/shared/protocol'

export type MenuActions = {
  openDialog: () => void
  send: (event: DesktopEvent) => void
  toggleDevTools: () => void
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
  { label: 'Play or Pause', action: 'togglePlay' },
  { label: 'Skip Back', action: 'skipBack' },
  { label: 'Skip Forward', action: 'skipForward' },
  { label: 'Next', action: 'next' },
  { label: 'Video Info', action: 'stats' },
] as const satisfies readonly { label: string; action: MenuPlayerAction }[]

/**
 * The menus from the spec's "Menus" table. Every accelerator holds a modifier:
 * single keys stay with the page, or a menu would take Space and the arrows from
 * the PIN field and the volume slider.
 */
export const menuTemplate = ({
  appName,
  isDevelopment,
  actions,
}: {
  appName: string
  isDevelopment: boolean
  actions: MenuActions
}): MenuEntry[] => {
  const player = (action: MenuPlayerAction) => () => actions.send({ type: 'player', action })

  return [
    {
      label: appName,
      submenu: [
        { role: 'about' },
        SEPARATOR,
        {
          label: 'Settings…',
          accelerator: 'CommandOrControl+,',
          click: () => actions.send({ type: 'navigate', to: 'settings' }),
        },
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
        { label: 'Open…', accelerator: 'CommandOrControl+O', click: actions.openDialog },
        // macOS keeps this list, fed by `app.addRecentDocument`; choosing one fires `open-file`.
        {
          label: 'Open Recent',
          role: 'recentDocuments',
          submenu: [{ role: 'clearRecentDocuments' }],
        },
        SEPARATOR,
        { role: 'close' },
      ],
    },
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
      submenu: [{ label: 'Keyboard Shortcuts', click: player('showShortcuts') }],
    },
  ]
}
