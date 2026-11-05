import {
  fillPath,
  HLS_PARAMS,
  HLS_PATHS,
  isHlsSessionId,
  MEDIA_TICKET_PARAM,
  PLAYBACK_MODES,
  type StreamQuality,
  toQueryString,
} from '@raven/core'

/**
 * The folder of a relayed HLS stream under its load's secret. No name mpv asks for in it carries
 * the server's session, ticket or capability, and each has the extension lavf's HLS demuxer wants
 * before it takes a playlist or a segment as one.
 */
const HLS_RELAY_DIR = 'hls'

/** The path under a load's secret that mpv opens for a transcode: the master playlist. */
export const HLS_MASTER_PATH = `${HLS_RELAY_DIR}/master.m3u8`

/** The parts of a session mpv asks for once the master named it. */
export const HLS_PARTS = { video: 'video', init: 'init', segment: 'segment' } as const

type HlsPartKind = (typeof HLS_PARTS)[keyof typeof HLS_PARTS]

export type HlsPart =
  | { kind: typeof HLS_PARTS.video }
  | { kind: typeof HLS_PARTS.init }
  | { kind: typeof HLS_PARTS.segment; n: number }

type PartRoute = {
  /** The server's route for the part, from `HLS_PATHS`. */
  server: string
  /** mpv's name for it, relative to the master and the video playlist, which share a folder. */
  relay: string
}

/** Each part's two names, the server's and the relay's; a segment's `:n` is its number in both. */
const PART_ROUTES = {
  [HLS_PARTS.video]: { server: HLS_PATHS.video, relay: 'video.m3u8' },
  [HLS_PARTS.init]: { server: HLS_PATHS.init, relay: 'init.mp4' },
  [HLS_PARTS.segment]: { server: HLS_PATHS.segment, relay: `segment/:${HLS_PARAMS.n}.m4s` },
} as const satisfies Record<HlsPartKind, PartRoute>

const PART_KINDS = Object.values(HLS_PARTS)

/** A segment number as the server's playlists count them, with room for a day of six-second segments. */
const SEGMENT_NUMBER = /^\d{1,6}$/u

/** A route as a pattern, each placeholder a named group; the routes hold no other pattern character but `.`. */
const patternOf = (path: string): RegExp =>
  new RegExp(`^${path.replaceAll('.', '\\.').replace(/:(\w+)/gu, '(?<$1>[^/]+)')}$`, 'u')

const RELAY_PATTERNS = {
  [HLS_PARTS.video]: patternOf(`${HLS_RELAY_DIR}/${PART_ROUTES.video.relay}`),
  [HLS_PARTS.init]: patternOf(`${HLS_RELAY_DIR}/${PART_ROUTES.init.relay}`),
  [HLS_PARTS.segment]: patternOf(`${HLS_RELAY_DIR}/${PART_ROUTES.segment.relay}`),
} as const satisfies Record<HlsPartKind, RegExp>

const SERVER_PATTERNS = {
  [HLS_PARTS.video]: patternOf(PART_ROUTES.video.server),
  [HLS_PARTS.init]: patternOf(PART_ROUTES.init.server),
  [HLS_PARTS.segment]: patternOf(PART_ROUTES.segment.server),
} as const satisfies Record<HlsPartKind, RegExp>

type Groups = Readonly<Record<string, string>>

type PartFromProps = { kind: HlsPartKind; groups: Groups }

/** The part a matched name stands for; a segment's needs a number the server could have written. */
const partFrom = ({ kind, groups }: PartFromProps): HlsPart | null => {
  if (kind !== HLS_PARTS.segment) return { kind }
  const n = groups[HLS_PARAMS.n] ?? ''
  return SEGMENT_NUMBER.test(n) ? { kind, n: Number(n) } : null
}

type MatchedPart = { part: HlsPart; groups: Groups }

type MatchPartProps = { path: string; patterns: Readonly<Record<HlsPartKind, RegExp>> }

/** The part whose pattern a path matches, with the placeholders it held, or null for none. */
const matchPart = ({ path, patterns }: MatchPartProps): MatchedPart | null =>
  PART_KINDS.reduce<MatchedPart | null>((found, kind) => {
    if (found !== null) return found
    const match = patterns[kind].exec(path)
    if (match === null) return null
    const groups = match.groups ?? {}
    const part = partFrom({ kind, groups })
    return part === null ? null : { part, groups }
  }, null)

/** The session part a path under a load's secret stands for, or null for any other path. */
export const hlsPartOf = (path: string): HlsPart | null =>
  matchPart({ path, patterns: RELAY_PATTERNS })?.part ?? null

/** The placeholders a part fills beyond its media and session: a segment's number. */
const paramsOf = (part: HlsPart): Readonly<Record<string, number>> =>
  part.kind === HLS_PARTS.segment ? { [HLS_PARAMS.n]: part.n } : {}

/** Where mpv asks for a part, relative to the master and the video playlist. */
const relayNameOf = (part: HlsPart): string =>
  fillPath({ path: PART_ROUTES[part.kind].relay, params: paramsOf(part) })

/** The session a master playlist opened: its id and the key (`?t=`) its routes take. */
export type HlsSession = { id: string; key: string }

type MasterRequestProps = { mediaId: number; quality: StreamQuality }

/** A server path and the query that goes beside the ticket. */
export type ServerRequest = { path: string; query: Readonly<Record<string, string>> }

/** The server's master playlist for a transcode at `quality`: its path and the query beside the ticket. */
export const masterRequestOf = ({ mediaId, quality }: MasterRequestProps): ServerRequest => ({
  path: fillPath({ path: HLS_PATHS.master, params: { [HLS_PARAMS.id]: mediaId } }),
  query: { [HLS_PARAMS.mode]: PLAYBACK_MODES.transcode, [HLS_PARAMS.quality]: quality },
})

type SessionUrlProps = { mediaId: number; session: HlsSession; part: HlsPart }

/** Where a session part is on the server, with the session's key, from the path on. */
export const sessionUrlOf = ({ mediaId, session, part }: SessionUrlProps): string => {
  const path = fillPath({
    path: PART_ROUTES[part.kind].server,
    params: { [HLS_PARAMS.id]: mediaId, [HLS_PARAMS.session]: session.id, ...paramsOf(part) },
  })
  return `${path}?${toQueryString({ [MEDIA_TICKET_PARAM]: session.key })}`
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

type NamedPartProps = { uri: string; mediaId: number }

/** What a server's playlist URI names: a part of a session of this media, with its key; null for anything else. */
const namedPartOf = ({ uri, mediaId }: NamedPartProps): Named | null => {
  const url = urlOf(uri)
  const key = url?.searchParams.get(MEDIA_TICKET_PARAM) ?? null
  if (url === null || key === null || key === '') return null
  const matched = matchPart({ path: url.pathname, patterns: SERVER_PATTERNS })
  if (matched === null) return null
  const { part, groups } = matched
  const session = groups[HLS_PARAMS.session] ?? ''
  if (groups[HLS_PARAMS.id] !== String(mediaId) || !isHlsSessionId(session)) return null
  return { part, session: { id: session, key } }
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

/** What a playlist's line comes to: what mpv reads in its place, if anything. */
const LINE_OUTCOMES = {
  kept: 'kept',
  named: 'named',
  dropped: 'dropped',
  refused: 'refused',
} as const

type LineOutcome =
  /** The line as mpv reads it, naming nothing. */
  | { kind: typeof LINE_OUTCOMES.kept; line: string }
  /** A line that named a session part, renamed for the relay, and the session it named. */
  | { kind: typeof LINE_OUTCOMES.named; line: string; session: HlsSession }
  /** A line left out: a comment or a subtitle rendition. */
  | { kind: typeof LINE_OUTCOMES.dropped }
  /** A line the relay does not pass on, which refuses the whole playlist. */
  | { kind: typeof LINE_OUTCOMES.refused }

type RewriteLineProps = { line: string; mediaId: number }

const kept = (line: string): LineOutcome => ({ kind: LINE_OUTCOMES.kept, line })
const DROPPED: LineOutcome = { kind: LINE_OUTCOMES.dropped }
const REFUSED: LineOutcome = { kind: LINE_OUTCOMES.refused }

type RelayUriProps = RewriteLineProps & { uri: string; written: (relayed: string) => string }

/** A part's URI checked and renamed for the relay, or the refusal of one that is not this media's. */
const relayUri = ({ uri, mediaId, written }: RelayUriProps): LineOutcome => {
  const named = namedPartOf({ uri, mediaId })
  if (named === null) return REFUSED
  return {
    kind: LINE_OUTCOMES.named,
    line: written(relayNameOf(named.part)),
    session: named.session,
  }
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

/** The line mpv reads for an outcome: none for one left out. */
const linesOf = (outcome: LineOutcome): readonly string[] => {
  switch (outcome.kind) {
    case LINE_OUTCOMES.kept:
    case LINE_OUTCOMES.named:
      return [outcome.line]
    case LINE_OUTCOMES.dropped:
    case LINE_OUTCOMES.refused:
      return []
    default: {
      const unreachable: never = outcome
      return unreachable
    }
  }
}

type RewritePlaylistProps = { text: string; mediaId: number }

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

/**
 * A server's master or video playlist as mpv may hold it: each URI becomes the relay's own name
 * for its part, with no session, ticket or capability, and the session it named is kept for the
 * relay. Text subtitle renditions are left out, since the title's subtitles come as sidecars, as
 * they do for its file. A URI that is not a part of one session of this media refuses the whole
 * playlist, so nothing the relay does not know of ever reaches mpv.
 */
export const rewritePlaylist = ({ text, mediaId }: RewritePlaylistProps): Rewritten => {
  // None belongs in a playlist the server wrote, and lavf may read one as a line ending.
  if ([...text].some(isControlCharacter)) return { kind: REWRITE_OUTCOMES.refused }
  const outcomes = text.split(LINE_ENDINGS).map((line) => rewriteLine({ line, mediaId }))
  const sessions = outcomes.flatMap((outcome) =>
    outcome.kind === LINE_OUTCOMES.named ? [outcome.session] : [],
  )
  const [session = null] = sessions
  const isOneSession = sessions.every(
    (other) => other.id === (session?.id ?? null) && other.key === (session?.key ?? null),
  )
  if (outcomes.some(({ kind }) => kind === LINE_OUTCOMES.refused) || !isOneSession) {
    return { kind: REWRITE_OUTCOMES.refused }
  }
  return {
    kind: REWRITE_OUTCOMES.rewritten,
    text: outcomes.flatMap(linesOf).join('\n'),
    session,
  }
}
