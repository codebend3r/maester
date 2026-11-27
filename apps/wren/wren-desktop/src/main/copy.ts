import { WREN_HOST_PORT } from '@raven/wren'

/** The app's name, as the menu bar, the Dock and the window say it. */
export const PRODUCT_NAME = 'Wren'

/** Every word the main process shows: the window's title, its menus and its dialogs. */
export const DESKTOP_COPY = {
  title: PRODUCT_NAME,
  cannotOpen: `${PRODUCT_NAME} could not open`,
  portTaken: `Another app is using port ${WREN_HOST_PORT} on this computer. Quit it, then open ${PRODUCT_NAME} again.`,
  cannotServe: (reason: string) => `${PRODUCT_NAME} could not start serving its page: ${reason}`,
  menu: {
    file: 'File',
    edit: 'Edit',
    view: 'View',
    window: 'Window',
    help: 'Help',
    showWindow: `Show ${PRODUCT_NAME}`,
    webSite: `${PRODUCT_NAME} on the web`,
  },
} as const
