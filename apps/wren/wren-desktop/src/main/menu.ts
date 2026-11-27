import type { MenuItemConstructorOptions } from 'electron'
import { DESKTOP_COPY } from '@/main/copy'

/** Wren on the web, which Help opens in the browser. */
export const WEB_SITE = 'https://wren.maester.tv'

type MenuTemplateProps = {
  /** An unpackaged run adds the developer tools to View. */
  isPackaged: boolean
  /** Brings the window back after it was closed, as a press on the Dock icon does. */
  showWindow: () => void
  openWebSite: () => void
}

/** The menu bar: macOS's own app, Edit and Window menus, with a View and a Help of Wren's. */
export const menuTemplate = ({
  isPackaged,
  showWindow,
  openWebSite,
}: MenuTemplateProps): MenuItemConstructorOptions[] => [
  { role: 'appMenu' },
  {
    label: DESKTOP_COPY.menu.file,
    submenu: [{ role: 'close' }],
  },
  { role: 'editMenu' },
  {
    label: DESKTOP_COPY.menu.view,
    submenu: [
      { role: 'reload' },
      ...(isPackaged ? [] : [{ role: 'toggleDevTools' } as const]),
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
    ],
  },
  {
    label: DESKTOP_COPY.menu.window,
    submenu: [
      { role: 'minimize' },
      { role: 'zoom' },
      { type: 'separator' },
      { label: DESKTOP_COPY.menu.showWindow, accelerator: 'CommandOrControl+0', click: showWindow },
      { type: 'separator' },
      { role: 'front' },
    ],
  },
  {
    role: 'help',
    label: DESKTOP_COPY.menu.help,
    submenu: [{ label: DESKTOP_COPY.menu.webSite, click: openWebSite }],
  },
]
