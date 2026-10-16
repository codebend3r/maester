/** What the preload exposes to the page as `window.ravenDesktop`. */
export type RavenDesktopBridge = {
  request: (request: unknown) => Promise<unknown>
  dropFiles: (files: readonly File[]) => Promise<unknown>
  subscribe: (listener: (event: unknown) => void) => () => void
}
