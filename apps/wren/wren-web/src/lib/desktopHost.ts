import { WREN_HOST_META } from '@raven/wren'

/**
 * The raven origin Wren for Mac names in the page it serves, or null in a browser, where no
 * `<meta>` names one. Its web host adds the tag, so its presence is how the page knows it runs there.
 */
export const desktopServerAddress = (): string | null =>
  document.querySelector(`meta[name="${WREN_HOST_META.serverAddress}"]`)?.getAttribute('content') ??
  null

/** Whether the page runs in Wren for Mac rather than a browser. */
export const isOnDesktop = (): boolean => desktopServerAddress() !== null
