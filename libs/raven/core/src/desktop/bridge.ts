import { oneOf } from '@/schema'

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
  platform: DesktopPlatform
}

/** The systems Raven runs on, as the page and main name them. */
export const DESKTOP_PLATFORMS = { mac: 'mac', windows: 'windows' } as const

export type DesktopPlatform = (typeof DESKTOP_PLATFORMS)[keyof typeof DESKTOP_PLATFORMS]

const isDesktopPlatform = oneOf(Object.values(DESKTOP_PLATFORMS))

/** The name the preload exposes the bridge under, `window.ravenDesktop`. */
export const RAVEN_DESKTOP_BRIDGE_KEY = 'ravenDesktop'

/** What the page calls the computer, in "On this Mac" and "free on this PC". */
export const COMPUTER_NAMES = {
  [DESKTOP_PLATFORMS.mac]: 'Mac',
  [DESKTOP_PLATFORMS.windows]: 'PC',
} as const satisfies Record<DesktopPlatform, string>

/**
 * Who draws the window's controls. `inset`: macOS's traffic lights, over a page that runs
 * under the title bar. `drawn`: the page, in a frameless window, as on Windows, where a
 * window transparent enough to show the video under the page cannot have a frame.
 */
export const WINDOW_CHROMES = { inset: 'inset', drawn: 'drawn' } as const

export type WindowChrome = (typeof WINDOW_CHROMES)[keyof typeof WINDOW_CHROMES]

/** Each system's window chrome: macOS keeps its traffic lights; Windows' frameless window has the page's. */
const WINDOW_CHROME_OF = {
  [DESKTOP_PLATFORMS.mac]: WINDOW_CHROMES.inset,
  [DESKTOP_PLATFORMS.windows]: WINDOW_CHROMES.drawn,
} as const satisfies Record<DesktopPlatform, WindowChrome>

type WindowChromeForProps = {
  platform: DesktopPlatform
}

/** The chrome Raven's window has on this platform. */
export const windowChromeFor = ({ platform }: WindowChromeForProps): WindowChrome =>
  WINDOW_CHROME_OF[platform]

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
  'platform' in value &&
  isDesktopPlatform(value.platform)
