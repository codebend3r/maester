import {
  HLS_PARAMS,
  HLS_PATHS,
  isHlsSessionId,
  MEDIA_TICKET_PARAM,
  PLAYBACK_MODES,
  type StreamQuality,
  toQueryString,
} from '@raven/core'

/**
 * The folder of a relayed HLS stream under its load's secret, and the names mpv asks for in it.
 * None carries the server's session, ticket or capability, and each has the extension lavf's HLS
 * demuxer wants before it takes a playlist or a segment as one.
 */
const HLS_RELAY_DIR = 'hls'

const HLS_RELAY_NAMES = {
  master: 'master.m3u8',
  video: 'video.m3u8',
  init: 'init.mp4',
} as const

const SEGMENT_DIR = 'segment'
const SEGMENT_EXTENSION = '.m4s'

/** The path under a load's secret that mpv opens for a transcode: the master playlist. */
export const HLS_MASTER_PATH = `${HLS_RELAY_DIR}/${HLS_RELAY_NAMES.master}`

/** The parts of a session mpv asks for once the master named it. */
export const HLS_PARTS = { video: 'video', init: 'init', segment: 'segment' } as const

export type HlsPart =
  | { kind: typeof HLS_PARTS.video }
  | { kind: typeof HLS_PARTS.init }
  | { kind: typeof HLS_PARTS.segment; n: number }

/** A segment number as the server's playlists count them, with room for a day of six-second segments. */
const SEGMENT_PATTERN = new RegExp(
  `^${HLS_RELAY_DIR}/${SEGMENT_DIR}/(\\d{1,6})\\${SEGMENT_EXTENSION}$`,
  'u',
)

/** The session part a path under a load's secret stands for, or null for any other path. */
export const hlsPartOf = (path: string): HlsPart | null => {
  if (path === `${HLS_RELAY_DIR}/${HLS_RELAY_NAMES.video}`) return { kind: HLS_PARTS.video }
  if (path === `${HLS_RELAY_DIR}/${HLS_RELAY_NAMES.init}`) return { kind: HLS_PARTS.init }
  const [, n] = SEGMENT_PATTERN.exec(path) ?? []
  return n === undefined ? null : { kind: HLS_PARTS.segment, n: Number(n) }
}

/** The session a master playlist opened: its id and the key (`?t=`) its routes take. */
export type HlsSession = { id: string; key: string }

type FillProps = { path: string; values: Readonly<Record<string, string>> }

const fill = ({ path, values }: FillProps): string =>
  path.replace(/:(\w+)/gu, (placeholder, name: string) => {
    const value = values[name]
    return value === undefined ? placeholder : encodeURIComponent(value)
  })

type MasterRequestProps = { mediaId: number; quality: StreamQuality }

type MasterRequest = { path: string; query: Readonly<Record<string, string>> }

/** The server's master playlist for a transcode at `quality`: its path and the query beside the ticket. */
export const masterRequestOf = ({ mediaId, quality }: MasterRequestProps): MasterRequest => ({
  path: fill({ path: HLS_PATHS.master, values: { [HLS_PARAMS.id]: String(mediaId) } }),
  query: { [HLS_PARAMS.mode]: PLAYBACK_MODES.transcode, [HLS_PARAMS.quality]: quality },
})

type SessionUrlProps = { mediaId: number; session: HlsSession; part: HlsPart }

/** Where a session part is on the server, with the session's key, from the path on. */
export const sessionUrlOf = ({ mediaId, session, part }: SessionUrlProps): string => {
  const values = { [HLS_PARAMS.id]: String(mediaId), [HLS_PARAMS.session]: session.id }
  const query = toQueryString({ [MEDIA_TICKET_PARAM]: session.key })
  switch (part.kind) {
    case HLS_PARTS.video:
      return `${fill({ path: HLS_PATHS.video, values })}?${query}`
    case HLS_PARTS.init:
      return `${fill({ path: HLS_PATHS.init, values })}?${query}`
    case HLS_PARTS.segment:
      return `${fill({ path: HLS_PATHS.segment, values: { ...values, [HLS_PARAMS.n]: String(part.n) } })}?${query}`
    default: {
      const unreachable: never = part
      return unreachable
    }
  }
}

/** A route's path as a pattern, each placeholder a group; `HLS_PATHS` holds no other pattern character but `.`. */
const patternOf = (path: string): RegExp =>
  new RegExp(`^${path.replaceAll('.', '\\.').replace(/:\w+/gu, '([^/]+)')}$`, 'u')

const VIDEO_PATTERN = patternOf(HLS_PATHS.video)
const INIT_PATTERN = patternOf(HLS_PATHS.init)
const SERVER_SEGMENT_PATTERN = patternOf(HLS_PATHS.segment)

/** Where mpv asks for a part, relative to the master and the video playlist, which share a folder. */
const relayNameOf = (part: HlsPart): string => {
  switch (part.kind) {
    case HLS_PARTS.video:
      return HLS_RELAY_NAMES.video
    case HLS_PARTS.init:
      return HLS_RELAY_NAMES.init
    case HLS_PARTS.segment:
      return `${SEGMENT_DIR}/${part.n}${SEGMENT_EXTENSION}`
    default: {
      const unreachable: never = part
      return unreachable
    }
  }
}

type Named = { part: HlsPart; session: HlsSession }

/** What a playlist URI is read against: the server writes each from the root, on its own host. */
const STAND_IN_ORIGIN = 'http://upstream.invalid'

/** A playlist URI from the root, read as a URL; null for one that names a host or is no URL. */
const urlOf = (uri: string): URL | null => {
  try {
    const url = new URL(uri, STAND_IN_ORIGIN)
    return url.origin === STAND_IN_ORIGIN ? url : null
  } catch {
    return null
  }
}

const SEGMENT_NUMBER = /^\d{1,6}$/u

type NamedPartProps = { uri: string; mediaId: number }

/** What a server's playlist URI names: a part of a session of this media, with its key; null for anything else. */
const namedPartOf = ({ uri, mediaId }: NamedPartProps): Named | null => {
  const url = urlOf(uri)
  const key = url?.searchParams.get(MEDIA_TICKET_PARAM) ?? null
  if (url === null || key === null || key === '') return null
  const [, videoId, videoSession] = VIDEO_PATTERN.exec(url.pathname) ?? []
  const [, initId, initSession] = INIT_PATTERN.exec(url.pathname) ?? []
  const [, segmentId, segmentSession, n] = SERVER_SEGMENT_PATTERN.exec(url.pathname) ?? []
  const found = [
    { id: videoId, session: videoSession, part: { kind: HLS_PARTS.video } },
    { id: initId, session: initSession, part: { kind: HLS_PARTS.init } },
    {
      id: segmentId,
      session: segmentSession,
      part: { kind: HLS_PARTS.segment, n: Number(n) },
    },
  ].find((candidate) => candidate.id !== undefined && candidate.session !== undefined)
  if (found === undefined || found.id !== String(mediaId) || !isHlsSessionId(found.session)) {
    return null
  }
  if (found.part.kind === HLS_PARTS.segment && !SEGMENT_NUMBER.test(n ?? '')) return null
  return { part: found.part, session: { id: found.session, key } }
}

/** The tags the server's playlists carry (`apps/raven/server/src/hls/playlists.ts`), the only ones passed on. */
const HLS_TAGS = {
  playlist: '#EXTM3U',
  version: '#EXT-X-VERSION',
  independentSegments: '#EXT-X-INDEPENDENT-SEGMENTS',
  playlistType: '#EXT-X-PLAYLIST-TYPE',
  targetDuration: '#EXT-X-TARGETDURATION',
  map: '#EXT-X-MAP',
  segment: '#EXTINF',
  endList: '#EXT-X-ENDLIST',
  variant: '#EXT-X-STREAM-INF',
  media: '#EXT-X-MEDIA',
} as const

const KNOWN_TAGS: ReadonlySet<string> = new Set(Object.values(HLS_TAGS))

/** What makes a line a tag; any other line starting with `#` is a comment, which mpv ignores. */
const TAG_PREFIX = '#EXT'
const COMMENT_PREFIX = '#'

/**
 * The one form a tag's URI may take here: the init segment's map, written by the server as this
 * and nothing more. A URI in any other attribute, any other quoting or case, a second URI or a
 * URI on any other tag refuses the playlist, since lavf would follow what the relay did not check.
 */
const MAP_LINE = /^#EXT-X-MAP:URI="([^"]*)"$/u

/** Anything a URI could hide behind, in any case: no tag but the map may carry one. */
const ANY_URI = /uri/iu

const SUBTITLE_TYPE = /^TYPE=SUBTITLES(?:,|$)/u
const SUBTITLE_GROUP = /,SUBTITLES="[^"]*"/u

export const REWRITE_OUTCOMES = { rewritten: 'rewritten', refused: 'refused' } as const

/** A playlist as mpv may hold it, and the session it named, if any. */
export type RewrittenPlaylist = {
  kind: typeof REWRITE_OUTCOMES.rewritten
  text: string
  session: HlsSession | null
}

type Rewritten = RewrittenPlaylist | { kind: typeof REWRITE_OUTCOMES.refused }

type LineOutcome = { line: string | null; named: Named | null; isRefused: boolean }

type RewriteLineProps = { line: string; mediaId: number }

const kept = (line: string): LineOutcome => ({ line, named: null, isRefused: false })
const DROPPED: LineOutcome = { line: null, named: null, isRefused: false }
const REFUSED: LineOutcome = { line: null, named: null, isRefused: true }

type RelayUriProps = RewriteLineProps & { uri: string; written: (relayed: string) => string }

/** A part's URI checked and renamed for the relay, or the refusal of one that is not this media's. */
const relayUri = ({ uri, mediaId, written }: RelayUriProps): LineOutcome => {
  const named = namedPartOf({ uri, mediaId })
  if (named === null) return REFUSED
  return { line: written(relayNameOf(named.part)), named, isRefused: false }
}

type RewriteTagProps = RewriteLineProps & { tag: string; attributes: string }

/** A tag line: only the server's own tags pass, and only the map names a URI. */
const rewriteTag = ({ line, mediaId, tag, attributes }: RewriteTagProps): LineOutcome => {
  if (!KNOWN_TAGS.has(tag)) return REFUSED
  // Text subtitles come as sidecars, so their renditions are left out whatever they hold.
  if (tag === HLS_TAGS.media) return SUBTITLE_TYPE.test(attributes) ? DROPPED : REFUSED
  if (tag === HLS_TAGS.map) {
    const [, uri] = MAP_LINE.exec(line) ?? []
    if (uri === undefined) return REFUSED
    return relayUri({
      line,
      mediaId,
      uri,
      written: (relayed) => `${HLS_TAGS.map}:URI="${relayed}"`,
    })
  }
  if (ANY_URI.test(line)) return REFUSED
  return kept(tag === HLS_TAGS.variant ? line.replace(SUBTITLE_GROUP, '') : line)
}

const rewriteLine = ({ line, mediaId }: RewriteLineProps): LineOutcome => {
  if (line === '') return kept(line)
  if (line.startsWith(TAG_PREFIX)) {
    const colon = line.indexOf(':')
    const tag = colon < 0 ? line : line.slice(0, colon)
    const attributes = colon < 0 ? '' : line.slice(colon + 1)
    return rewriteTag({ line, mediaId, tag, attributes })
  }
  if (line.startsWith(COMMENT_PREFIX)) return DROPPED
  return relayUri({ line, mediaId, uri: line, written: (relayed) => relayed })
}

type RewritePlaylistProps = { text: string; mediaId: number }

/**
 * A server's master or video playlist as mpv may hold it: each URI becomes the relay's own name
 * for its part, with no session, ticket or capability, and the session it named is kept for the
 * relay. Text subtitle renditions are left out, since the title's subtitles come as sidecars, as
 * they do for its file. A URI that is not a part of one session of this media refuses the whole
 * playlist, so nothing the relay does not know of ever reaches mpv.
 */
/** Every line ending lavf honours, so no line mpv reads is one the relay did not check. */
const LINE_ENDINGS = /\r\n|\r|\n/u

/** Tab, line feed and carriage return: the only control characters a playlist may hold. */
const ALLOWED_CONTROL_CODES: ReadonlySet<number> = new Set([0x09, 0x0a, 0x0d])

/** The first code point past the C0 controls, and DEL. */
const CONTROL_CODES = { printable: 0x20, delete: 0x7f } as const

/** Whether a character is a C0 control other than tab or a line ending, or DEL. */
const isControlCharacter = (character: string): boolean => {
  const code = character.codePointAt(0) ?? 0
  const isC0 = code < CONTROL_CODES.printable && !ALLOWED_CONTROL_CODES.has(code)
  return isC0 || code === CONTROL_CODES.delete
}

export const rewritePlaylist = ({ text, mediaId }: RewritePlaylistProps): Rewritten => {
  // None belongs in a playlist the server wrote, and lavf may read one as a line ending.
  if ([...text].some(isControlCharacter)) return { kind: REWRITE_OUTCOMES.refused }
  const outcomes = text.split(LINE_ENDINGS).map((line) => rewriteLine({ line, mediaId }))
  const sessions = outcomes.flatMap(({ named }) => (named === null ? [] : [named.session]))
  const [session = null] = sessions
  const isOneSession = sessions.every(
    (other) => other.id === (session?.id ?? null) && other.key === (session?.key ?? null),
  )
  if (outcomes.some(({ isRefused }) => isRefused) || !isOneSession) {
    return { kind: REWRITE_OUTCOMES.refused }
  }
  return {
    kind: REWRITE_OUTCOMES.rewritten,
    text: outcomes.flatMap(({ line }) => (line === null ? [] : [line])).join('\n'),
    session,
  }
}
