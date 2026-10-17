/**
 * What the preload exposes to the page as `window.ravenDesktop`. The player's port is not
 * on it: the preload hands it over with `window.postMessage`, since a port cannot cross
 * `contextBridge`.
 */
export type RavenDesktopBridge = {
  request: (request: unknown) => Promise<unknown>
  dropFiles: (files: readonly File[]) => Promise<unknown>
  subscribe: (listener: (event: unknown) => void) => () => void
}
