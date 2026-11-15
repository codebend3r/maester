import { isMediaId } from '@/contract/ids'
import { isSagaId } from '@/contract/sessions'
import { toQueryString } from '@/query'
import { type Infer, isNumber, literal, object, union } from '@/schema'
import { serverOriginOf } from '@/serverOrigin'
import { LINK_SCHEME, URL_PROTOCOLS } from '@/urls'

export const PLAY_LINK_MAX_NEXT = 100

/** The longest link Raven reads. */
export const MAX_LINK_LENGTH = 4096

/** What a `raven://` link asks for, named by its host. */
export const LINK_HOSTS = { play: 'play', download: 'download' } as const

/** The query parameters of `raven://play` and `raven://download`. */
export const LINK_PARAMS = {
  server: 'server',
  media: 'media',
  at: 'at',
  next: 'next',
  item: 'item',
  saga: 'saga',
  album: 'album',
  playlist: 'playlist',
} as const

const linkOf = (host: string): string => `${LINK_SCHEME}://${host}`

/** What a link asks the desktop to play: the server's origin, the title, where to start, and what plays after it. */
export type PlayRequest = { origin: string; mediaId: number; at: number; next: number[] }

const startOf = (at: number): number => {
  const seconds = isNumber(at) ? Math.max(0, Math.floor(at)) : 0
  return Number.isSafeInteger(seconds) ? seconds : 0
}

/** The link for a title; throws for a `mediaId` that is not one, and leaves out `next` ids that are not. */
export const playLinkFor = ({ origin, mediaId, at, next }: PlayRequest): string => {
  if (!isMediaId(mediaId)) throw new RangeError(`${mediaId} is not a media id`)
  const query = toQueryString({
    [LINK_PARAMS.server]: origin,
    [LINK_PARAMS.media]: String(mediaId),
    [LINK_PARAMS.at]: String(startOf(at)),
  })
  const queue = next.filter(isMediaId).slice(0, PLAY_LINK_MAX_NEXT)
  const play = linkOf(LINK_HOSTS.play)
  if (queue.length === 0) return `${play}?${query}`
  return `${play}?${query}&${toQueryString({ [LINK_PARAMS.next]: queue.join(',') })}`
}

export const DOWNLOAD_TARGET_KINDS = {
  media: 'media',
  item: 'item',
  saga: 'saga',
  album: 'album',
  playlist: 'playlist',
} as const

/** What a download link asks the desktop to keep: one file, one title, one collection of a library, an album or a playlist. */
export const isDownloadTarget = union(
  object({ kind: literal(DOWNLOAD_TARGET_KINDS.media), mediaId: isMediaId }),
  object({ kind: literal(DOWNLOAD_TARGET_KINDS.item), itemId: isMediaId }),
  object({
    kind: literal(DOWNLOAD_TARGET_KINDS.saga),
    libraryId: isMediaId,
    tmdbId: isSagaId,
  }),
  object({ kind: literal(DOWNLOAD_TARGET_KINDS.album), albumId: isMediaId }),
  object({ kind: literal(DOWNLOAD_TARGET_KINDS.playlist), playlistId: isMediaId }),
)

export type DownloadTarget = Infer<typeof isDownloadTarget>

export type DownloadRequest = { origin: string; target: DownloadTarget }

type DownloadLinkWithProps = { origin: string; param: string; value: string }

const downloadLinkWith = ({ origin, param, value }: DownloadLinkWithProps): string =>
  `${linkOf(LINK_HOSTS.download)}?${toQueryString({ [LINK_PARAMS.server]: origin, [param]: value })}`

/** The link for a download; throws for an id that is not one. */
export const downloadLinkFor = ({ origin, target }: DownloadRequest): string => {
  switch (target.kind) {
    case DOWNLOAD_TARGET_KINDS.media: {
      if (!isMediaId(target.mediaId)) throw new RangeError(`${target.mediaId} is not a media id`)
      return downloadLinkWith({ origin, param: LINK_PARAMS.media, value: String(target.mediaId) })
    }
    case DOWNLOAD_TARGET_KINDS.item: {
      if (!isMediaId(target.itemId)) throw new RangeError(`${target.itemId} is not an item id`)
      return downloadLinkWith({ origin, param: LINK_PARAMS.item, value: String(target.itemId) })
    }
    case DOWNLOAD_TARGET_KINDS.saga: {
      if (!isMediaId(target.libraryId)) {
        throw new RangeError(`${target.libraryId} is not a library id`)
      }
      if (!isSagaId(target.tmdbId)) {
        throw new RangeError(`${target.tmdbId} is not a collection id`)
      }
      const saga = `${target.libraryId}:${target.tmdbId}`
      return downloadLinkWith({ origin, param: LINK_PARAMS.saga, value: saga })
    }
    case DOWNLOAD_TARGET_KINDS.album: {
      if (!isMediaId(target.albumId)) throw new RangeError(`${target.albumId} is not an album id`)
      return downloadLinkWith({ origin, param: LINK_PARAMS.album, value: String(target.albumId) })
    }
    case DOWNLOAD_TARGET_KINDS.playlist: {
      if (!isMediaId(target.playlistId)) {
        throw new RangeError(`${target.playlistId} is not a playlist id`)
      }
      return downloadLinkWith({
        origin,
        param: LINK_PARAMS.playlist,
        value: String(target.playlistId),
      })
    }
    default: {
      const unreachable: never = target
      throw new RangeError(`unknown download target ${JSON.stringify(unreachable)}`)
    }
  }
}

/**
 * The parts of a parsed address the readers look at: what WHATWG's `URL` gives, which core
 * cannot use itself, so the caller parses (`URL.canParse(raw) ? new URL(raw) : null`).
 */
export type ParsedLink = {
  protocol: string
  host: string
  username: string
  password: string
  port: string
  pathname: string
  href: string
  searchParams: { entries: () => Iterable<[string, string]> }
}

/** Parses an address the way WHATWG's `URL` does, or null for one it cannot parse. */
export type LinkParser = (raw: string) => ParsedLink | null

const ROOT_PATH = '/'

/*
 * `new URL` silently drops tabs and newlines and ignores zero-width characters
 * in a host, so what it would rewrite is refused up front.
 */
const HIDDEN = /[\s\p{Cc}\p{Cf}]/u
// A watch page's scheme and authority as written: `new URL` drops an empty user.
const WATCH_AUTHORITY = /^https?:\/\/[^/?#\\]*/i
const MEDIA_ID = /^[1-9]\d{0,15}$/
const SECONDS = /^\d+(\.\d+)?$/
const WATCH_PATH = /^\/watch\/([1-9]\d{0,15})\/?$/
const SAGA = /^([1-9]\d{0,15}):([1-9]\d{0,15})$/
const PLAY_KEYS: ReadonlySet<string> = new Set([
  LINK_PARAMS.server,
  LINK_PARAMS.media,
  LINK_PARAMS.at,
  LINK_PARAMS.next,
])
const DOWNLOAD_KEYS: ReadonlySet<string> = new Set([
  LINK_PARAMS.server,
  LINK_PARAMS.media,
  LINK_PARAMS.item,
  LINK_PARAMS.saga,
  LINK_PARAMS.album,
  LINK_PARAMS.playlist,
])

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

type ReadRavenParamsProps = {
  url: ParsedLink
  host: string
  keys: ReadonlySet<string>
}

/** The query of a `raven://<host>` link as a map, or null when the link is not strictly that host's. */
const readRavenParams = ({
  url,
  host,
  keys: allowed,
}: ReadRavenParamsProps): Map<string, string> | null => {
  // `raven:` is not a special scheme, so `new URL` keeps the host's case as written.
  if (url.host.toLowerCase() !== host) return null
  if (url.username !== '' || url.password !== '' || url.port !== '') return null
  if (url.pathname !== '' && url.pathname !== ROOT_PATH) return null
  // `url.hash` is empty for a bare `#`, which `href` keeps.
  if (url.href.includes('#')) return null

  const entries = Array.from(url.searchParams.entries())
  const keys = entries.map(([key]) => key)
  if (new Set(keys).size !== keys.length) return null
  if (!keys.every((key) => allowed.has(key))) return null
  return new Map(entries)
}

const readPlayQuery = (url: ParsedLink): PlayRequest | null => {
  const params = readRavenParams({ url, host: LINK_HOSTS.play, keys: PLAY_KEYS })
  if (params === null) return null
  const server = params.get(LINK_PARAMS.server)
  const media = params.get(LINK_PARAMS.media)
  if (server === undefined || media === undefined) return null
  const origin = serverOriginOf(server)
  const mediaId = mediaIdOf(media)
  const at = secondsOf(params.get(LINK_PARAMS.at))
  const next = queueOf(params.get(LINK_PARAMS.next))
  if (origin === null || mediaId === null || at === null || next === null) return null
  return { origin, mediaId, at, next }
}

/** Each single-id target's parameter, and the target it names. */
const ID_TARGETS = [
  {
    param: LINK_PARAMS.media,
    target: (mediaId: number) => ({ kind: DOWNLOAD_TARGET_KINDS.media, mediaId }),
  },
  {
    param: LINK_PARAMS.item,
    target: (itemId: number) => ({ kind: DOWNLOAD_TARGET_KINDS.item, itemId }),
  },
  {
    param: LINK_PARAMS.album,
    target: (albumId: number) => ({ kind: DOWNLOAD_TARGET_KINDS.album, albumId }),
  },
  {
    param: LINK_PARAMS.playlist,
    target: (playlistId: number) => ({ kind: DOWNLOAD_TARGET_KINDS.playlist, playlistId }),
  },
] as const satisfies readonly { param: string; target: (id: number) => DownloadTarget }[]

const sagaTargetOf = (saga: string): DownloadTarget | null => {
  const match = SAGA.exec(saga)
  const libraryId = mediaIdOf(match?.[1] ?? '')
  const tmdbId = match?.[2]
  if (libraryId === null || tmdbId === undefined) return null
  return { kind: DOWNLOAD_TARGET_KINDS.saga, libraryId, tmdbId }
}

const targetOf = (params: Map<string, string>): DownloadTarget | null => {
  const named = [...ID_TARGETS.map(({ param }) => param), LINK_PARAMS.saga].filter((param) =>
    params.has(param),
  )
  if (named.length !== 1) return null
  const saga = params.get(LINK_PARAMS.saga)
  if (saga !== undefined) return sagaTargetOf(saga)
  const found = ID_TARGETS.find(({ param }) => params.has(param))
  const id = mediaIdOf(params.get(found?.param ?? '') ?? '')
  return found === undefined || id === null ? null : found.target(id)
}

const readDownloadQuery = (url: ParsedLink): DownloadRequest | null => {
  const params = readRavenParams({ url, host: LINK_HOSTS.download, keys: DOWNLOAD_KEYS })
  if (params === null) return null
  const origin = serverOriginOf(params.get(LINK_PARAMS.server) ?? '')
  const target = targetOf(params)
  if (origin === null || target === null) return null
  return { origin, target }
}

/** A link as typed, trimmed, and as parsed. */
type ParsedText = { url: ParsedLink; text: string }

const readWatchPage = ({ url, text }: ParsedText): PlayRequest | null => {
  const match = WATCH_PATH.exec(url.pathname)
  const mediaId = mediaIdOf(match?.[1] ?? '')
  const origin = serverOriginOf(WATCH_AUTHORITY.exec(text)?.[0] ?? '')
  if (mediaId === null || origin === null) return null
  return { origin, mediaId, at: 0, next: [] }
}

type ReadLinkProps = {
  link: string
  parse: LinkParser
}

/** `link` trimmed and parsed, or null for one too long, hiding characters, or not an address. */
const parsedOf = ({ link, parse }: ReadLinkProps): ParsedText | null => {
  const text = link.trim()
  if (text.length > MAX_LINK_LENGTH || HIDDEN.test(text)) return null
  const url = parse(text)
  return url === null ? null : { url, text }
}

/** What a `raven://play` link or a pasted watch page asks for, or null for anything else. */
export const readPlayLink = (props: ReadLinkProps): PlayRequest | null => {
  const parsed = parsedOf(props)
  if (parsed === null) return null
  const { url, text } = parsed
  if (url.protocol === URL_PROTOCOLS.raven) return readPlayQuery(url)
  if (url.protocol === URL_PROTOCOLS.http || url.protocol === URL_PROTOCOLS.https) {
    return readWatchPage({ url, text })
  }
  return null
}

/** What a `raven://download` link asks to keep, or null for anything else. */
export const readDownloadLink = (props: ReadLinkProps): DownloadRequest | null => {
  const parsed = parsedOf(props)
  if (parsed === null || parsed.url.protocol !== URL_PROTOCOLS.raven) return null
  return readDownloadQuery(parsed.url)
}
