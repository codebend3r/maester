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
  windowChrome: WindowChrome
}

/**
 * Who draws the window's controls. `inset`: macOS's traffic lights, over a page that runs
 * under the title bar. `drawn`: the page, in a frameless window, as on Windows, where a
 * window transparent enough to show the video under the page cannot have a frame.
 */
export const WINDOW_CHROMES = { inset: 'inset', drawn: 'drawn' } as const

export type WindowChrome = (typeof WINDOW_CHROMES)[keyof typeof WINDOW_CHROMES]

const isWindowChrome = (value: unknown): value is WindowChrome =>
  Object.values(WINDOW_CHROMES).some((chrome) => chrome === value)

// Node's name for Windows; core has no Node types, so it is spelled here.
const WINDOWS_PLATFORM = 'win32'

type WindowChromeForProps = {
  platform: string
}

/** The chrome Raven's window has on this platform. */
export const windowChromeFor = ({ platform }: WindowChromeForProps): WindowChrome =>
  platform === WINDOWS_PLATFORM ? WINDOW_CHROMES.drawn : WINDOW_CHROMES.inset

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
  isFunction(value.subscribe) &&
  'windowChrome' in value &&
  isWindowChrome(value.windowChrome)
