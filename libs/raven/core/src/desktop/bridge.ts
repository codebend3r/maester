/**
 * What the preload exposes to the page as `window.ravenDesktop`. The player's port is not
 * on it: the preload hands it over with `window.postMessage`, since a port cannot cross
 * `contextBridge`. `dropFiles` takes `unknown` files because core has no DOM types for `File`;
 * the preload checks what it gets.
 */
export type RavenDesktopBridge = {
  request: (request: unknown) => Promise<unknown>
  dropFiles: (files: readonly unknown[]) => Promise<unknown>
  subscribe: (listener: (event: unknown) => void) => () => void
}

const isFunction = (value: unknown): value is (...args: never[]) => unknown =>
  typeof value === 'function'

/** Whether `value` is the preload's bridge: what the page checks `window.ravenDesktop` with. */
export const isRavenDesktopBridge = (value: unknown): value is RavenDesktopBridge =>
  typeof value === 'object' &&
  value !== null &&
  'request' in value &&
  isFunction(value.request) &&
  'dropFiles' in value &&
  isFunction(value.dropFiles) &&
  'subscribe' in value &&
  isFunction(value.subscribe)
