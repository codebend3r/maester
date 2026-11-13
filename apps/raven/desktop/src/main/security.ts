import { PAGE_ORIGIN, URL_PROTOCOLS } from '@raven/core'

/** The permissions the page may have; Electron names permissions as plain strings. */
export const PERMISSIONS = {
  fullscreen: 'fullscreen',
  // The web app's Copy buttons write with the Clipboard API.
  clipboardWrite: 'clipboard-sanitized-write',
} as const

const ALLOWED_PERMISSIONS = new Set<string>(Object.values(PERMISSIONS))

const parse = (url: string): URL | null => (URL.canParse(url) ? new URL(url) : null)

/** The web host's own page, `http://localhost:47484`, with no credentials in the address. */
export const isPageUrl = (url: string): boolean => {
  const parsed = parse(url)
  if (parsed === null) return false
  return parsed.origin === PAGE_ORIGIN && parsed.username === '' && parsed.password === ''
}

export const isExternalLink = (url: string): boolean => {
  const protocol = parse(url)?.protocol ?? ''
  return protocol === URL_PROTOCOLS.http || protocol === URL_PROTOCOLS.https
}

const isElsewhere = (url: string): boolean => isExternalLink(url) && !isPageUrl(url)

/** What Electron's `setWindowOpenHandler` is answered: no new window, ever. */
const WINDOW_OPEN_ACTIONS = { deny: 'deny' } as const

type WindowOpen = { action: typeof WINDOW_OPEN_ACTIONS.deny; shouldOpenExternally: boolean }

export const windowOpenFor = (url: string): WindowOpen => ({
  action: WINDOW_OPEN_ACTIONS.deny,
  shouldOpenExternally: isElsewhere(url),
})

/** The window stays on the page; a web address anywhere else opens in the browser instead. */
export const navigationFor = (
  url: string,
): { isAllowed: boolean; shouldOpenExternally: boolean } => {
  if (isPageUrl(url)) return { isAllowed: true, shouldOpenExternally: false }
  return { isAllowed: false, shouldOpenExternally: isElsewhere(url) }
}

export const isPermissionAllowed = (permission: string): boolean =>
  ALLOWED_PERMISSIONS.has(permission)

export const isTrustedSender = (frameUrl: string | null | undefined): boolean =>
  !!frameUrl && isPageUrl(frameUrl)
