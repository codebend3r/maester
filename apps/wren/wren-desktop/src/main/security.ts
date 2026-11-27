import { URL_PROTOCOLS } from '@raven/core'
import { WREN_PAGE_ORIGIN } from '@raven/wren'

/** The permissions the page may have; Electron names permissions as plain strings. */
export const PERMISSIONS = {
  fullscreen: 'fullscreen',
  // The web app's Copy buttons write with the Clipboard API.
  clipboardWrite: 'clipboard-sanitized-write',
} as const

const ALLOWED_PERMISSIONS: ReadonlySet<string> = new Set(Object.values(PERMISSIONS))

const parse = (url: string): URL | null => (URL.canParse(url) ? new URL(url) : null)

/** The web host's own page, `http://localhost:47485`, with no credentials in the address. */
export const isPageUrl = (url: string): boolean => {
  const parsed = parse(url)
  if (parsed === null) return false
  return parsed.origin === WREN_PAGE_ORIGIN && parsed.username === '' && parsed.password === ''
}

const isWebAddress = (url: string): boolean => {
  const protocol = parse(url)?.protocol ?? ''
  return protocol === URL_PROTOCOLS.http || protocol === URL_PROTOCOLS.https
}

const isElsewhere = (url: string): boolean => isWebAddress(url) && !isPageUrl(url)

/** What Electron's `setWindowOpenHandler` is answered: no new window, ever. */
export const WINDOW_OPEN_ACTIONS = { deny: 'deny' } as const

export type WindowOpen = { action: typeof WINDOW_OPEN_ACTIONS.deny; shouldOpenExternally: boolean }

/** A link the page opens in a new tab goes to the browser when it is a web address elsewhere. */
export const windowOpenFor = (url: string): WindowOpen => ({
  action: WINDOW_OPEN_ACTIONS.deny,
  shouldOpenExternally: isElsewhere(url),
})

export type Navigation = { isAllowed: boolean; shouldOpenExternally: boolean }

/** The window stays on the page; a web address anywhere else opens in the browser instead. */
export const navigationFor = (url: string): Navigation => {
  if (isPageUrl(url)) return { isAllowed: true, shouldOpenExternally: false }
  return { isAllowed: false, shouldOpenExternally: isElsewhere(url) }
}

export const isPermissionAllowed = (permission: string): boolean =>
  ALLOWED_PERMISSIONS.has(permission)
