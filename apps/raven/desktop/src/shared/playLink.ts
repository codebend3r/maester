import { PLAY_LINK_MAX_NEXT, type PlayRequest, isMediaId, isString } from '@raven/core'

export const MAX_LINK_LENGTH = 4096
export const MAX_ORIGIN_LENGTH = 2048

// `new URL` silently drops tabs and newlines and ignores zero-width characters
// in a host, so what it would rewrite is refused up front.
const HIDDEN = /[\s\p{Cc}\p{Cf}]/u
const HTTP_ORIGIN_ONLY = /^https?:\/\/[^/\\]+\/?$/i
// A watch page's scheme and authority as written: `new URL` drops an empty user.
const WATCH_AUTHORITY = /^https?:\/\/[^/?#\\]*/i
const MEDIA_ID = /^[1-9]\d{0,15}$/
const SECONDS = /^\d+(\.\d+)?$/
const WATCH_PATH = /^\/watch\/([1-9]\d{0,15})\/?$/
const LINK_KEYS = new Set(['server', 'media', 'at', 'next'])

const parse = (raw: string): URL | null => (URL.canParse(raw) ? new URL(raw) : null)

/** The normalised origin of a server address, or null for anything that is not a bare http or https origin. */
export const serverOriginOf = (raw: string): string | null => {
  const address = raw.trim()
  if (address.length > MAX_ORIGIN_LENGTH) return null
  if (address.includes('@') || address.includes('?') || address.includes('#')) return null
  if (HIDDEN.test(address) || !HTTP_ORIGIN_ONLY.test(address)) return null
  const url = parse(address)
  if (url === null) return null
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (url.hostname === '' || url.pathname !== '/') return null
  // A trailing dot names the same host as a second origin; port 0 reaches nothing.
  if (url.hostname.endsWith('.') || url.port === '0') return null
  return url.origin
}

export const isServerOrigin = (value: unknown): value is string =>
  isString(value) && serverOriginOf(value) === value

const mediaIdOf = (text: string): number | null => {
  if (!MEDIA_ID.test(text)) return null
  const id = Number(text)
  return isMediaId(id) ? id : null
}

const secondsOf = (text: string | undefined): number | null => {
  if (text === undefined) return 0
  if (!SECONDS.test(text)) return null
  const seconds = Number(text)
  return Number.isFinite(seconds) ? seconds : null
}

const queueOf = (text: string | undefined): number[] | null => {
  if (text === undefined || text === '') return []
  const parts = text.split(',')
  if (parts.length > PLAY_LINK_MAX_NEXT) return null
  const ids = parts.map(mediaIdOf)
  return ids.every(isMediaId) ? ids : null
}

const readRavenLink = ({ url }: { url: URL }): PlayRequest | null => {
  // `raven:` is not a special scheme, so `new URL` keeps the host's case as written.
  if (url.host.toLowerCase() !== 'play') return null
  if (url.username !== '' || url.password !== '' || url.port !== '') return null
  if (url.pathname !== '' && url.pathname !== '/') return null
  // `url.hash` is empty for a bare `#`, which `href` keeps.
  if (url.href.includes('#')) return null

  const entries = Array.from(url.searchParams.entries())
  const keys = entries.map(([key]) => key)
  if (new Set(keys).size !== keys.length) return null
  if (!keys.every((key) => LINK_KEYS.has(key))) return null

  const params = new Map(entries)
  const server = params.get('server')
  const media = params.get('media')
  if (server === undefined || media === undefined) return null
  const origin = serverOriginOf(server)
  const mediaId = mediaIdOf(media)
  const at = secondsOf(params.get('at'))
  const next = queueOf(params.get('next'))
  if (origin === null || mediaId === null || at === null || next === null) return null
  return { origin, mediaId, at, next }
}

const readWatchPage = ({ url, text }: { url: URL; text: string }): PlayRequest | null => {
  const match = WATCH_PATH.exec(url.pathname)
  const mediaId = mediaIdOf(match?.[1] ?? '')
  const origin = serverOriginOf(WATCH_AUTHORITY.exec(text)?.[0] ?? '')
  if (mediaId === null || origin === null) return null
  return { origin, mediaId, at: 0, next: [] }
}

/** What a `raven://play` link or a pasted watch page asks for, or null for anything else. */
export const readPlayLink = (link: string): PlayRequest | null => {
  const text = link.trim()
  if (text.length > MAX_LINK_LENGTH || HIDDEN.test(text)) return null
  const url = parse(text)
  if (url === null) return null
  if (url.protocol === 'raven:') return readRavenLink({ url })
  if (url.protocol === 'http:' || url.protocol === 'https:') return readWatchPage({ url, text })
  return null
}

export const watchUrlFor = ({ origin, mediaId }: { origin: string; mediaId: number }): string =>
  `${origin}/watch/${mediaId}`
