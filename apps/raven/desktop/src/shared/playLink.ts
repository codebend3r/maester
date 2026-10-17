import {
  type DownloadRequest,
  PLAY_LINK_MAX_NEXT,
  type PlayRequest,
  isMediaId,
  isString,
} from '@raven/core'

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
const SAGA = /^([1-9]\d{0,15}):([1-9]\d{0,15})$/
const LINK_KEYS = new Set(['server', 'media', 'at', 'next'])
const DOWNLOAD_KEYS = new Set(['server', 'media', 'item', 'saga'])

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

/** The query of a `raven://<host>` link as a map, or null when the link is not strictly that host's. */
const readRavenParams = ({
  url,
  host,
  keys: allowed,
}: {
  url: URL
  host: string
  keys: ReadonlySet<string>
}): Map<string, string> | null => {
  // `raven:` is not a special scheme, so `new URL` keeps the host's case as written.
  if (url.host.toLowerCase() !== host) return null
  if (url.username !== '' || url.password !== '' || url.port !== '') return null
  if (url.pathname !== '' && url.pathname !== '/') return null
  // `url.hash` is empty for a bare `#`, which `href` keeps.
  if (url.href.includes('#')) return null

  const entries = Array.from(url.searchParams.entries())
  const keys = entries.map(([key]) => key)
  if (new Set(keys).size !== keys.length) return null
  if (!keys.every((key) => allowed.has(key))) return null
  return new Map(entries)
}

const readPlayQuery = ({ url }: { url: URL }): PlayRequest | null => {
  const params = readRavenParams({ url, host: 'play', keys: LINK_KEYS })
  if (params === null) return null
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

const targetOf = ({
  params,
}: {
  params: Map<string, string>
}): DownloadRequest['target'] | null => {
  const media = params.get('media')
  const item = params.get('item')
  const saga = params.get('saga')
  const named = [media, item, saga].filter((value) => value !== undefined)
  if (named.length !== 1) return null
  if (media !== undefined) {
    const mediaId = mediaIdOf(media)
    return mediaId === null ? null : { kind: 'media', mediaId }
  }
  if (item !== undefined) {
    const itemId = mediaIdOf(item)
    return itemId === null ? null : { kind: 'item', itemId }
  }
  const match = SAGA.exec(saga ?? '')
  const libraryId = mediaIdOf(match?.[1] ?? '')
  const tmdbId = match?.[2]
  if (libraryId === null || tmdbId === undefined) return null
  return { kind: 'saga', libraryId, tmdbId }
}

const readDownloadQuery = ({ url }: { url: URL }): DownloadRequest | null => {
  const params = readRavenParams({ url, host: 'download', keys: DOWNLOAD_KEYS })
  if (params === null) return null
  const origin = serverOriginOf(params.get('server') ?? '')
  const target = targetOf({ params })
  if (origin === null || target === null) return null
  return { origin, target }
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
  if (url.protocol === 'raven:') return readPlayQuery({ url })
  if (url.protocol === 'http:' || url.protocol === 'https:') return readWatchPage({ url, text })
  return null
}

/** What a `raven://download` link asks to keep, or null for anything else. */
export const readDownloadLink = (link: string): DownloadRequest | null => {
  const text = link.trim()
  if (text.length > MAX_LINK_LENGTH || HIDDEN.test(text)) return null
  const url = parse(text)
  if (url === null || url.protocol !== 'raven:') return null
  return readDownloadQuery({ url })
}

export const watchUrlFor = ({ origin, mediaId }: { origin: string; mediaId: number }): string =>
  `${origin}/watch/${mediaId}`
