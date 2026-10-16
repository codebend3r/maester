import { APP_HOST, APP_SCHEME } from '@/shared/protocol'

const parse = (url: string): URL | null => {
  try {
    return new URL(url)
  } catch {
    return null
  }
}

// Node's URL gives a custom scheme an opaque origin ('null'), so protocol and host are compared.
export const isAppUrl = (url: string): boolean => {
  const parsed = parse(url)
  if (parsed === null) return false
  return (
    parsed.protocol === `${APP_SCHEME}:` &&
    parsed.host === APP_HOST &&
    parsed.username === '' &&
    parsed.password === ''
  )
}

export const isExternalLink = (url: string): boolean => {
  const protocol = parse(url)?.protocol ?? ''
  return protocol === 'http:' || protocol === 'https:'
}

export const windowOpenFor = (url: string): { action: 'deny'; shouldOpenExternally: boolean } => ({
  action: 'deny',
  shouldOpenExternally: isExternalLink(url),
})

export const isPermissionAllowed = (permission: string): boolean => permission === 'fullscreen'

export const isTrustedSender = (frameUrl: string | null | undefined): boolean =>
  !!frameUrl && isAppUrl(frameUrl)
