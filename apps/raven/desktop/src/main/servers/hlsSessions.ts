import { TICKET_OUTCOMES } from '@/main/servers/accountTickets'
import { readShort } from '@/main/servers/authRefusals'
import { OVERFLOWS, readCapped } from '@/main/servers/cappedBody'
import {
  type HlsPart,
  type HlsSession,
  REWRITE_OUTCOMES,
  type RewrittenPlaylist,
  rewritePlaylist,
  sessionUrlOf,
} from '@/main/servers/hlsRelay'
import {
  discard,
  type Fetched,
  RELAY_METHODS,
  type RelayMethod,
  type RelayRequest,
  type TicketFailure,
  type Upstream,
} from '@/main/servers/relayUpstream'
import { loggable } from '@/main/servers/serverCalls'
import { HTTP_HEADERS } from '@/shared/httpHeaders'
import { HTTP_STATUSES, isSuccessStatus } from '@/shared/httpStatuses'

/** The most of a playlist the relay reads: a VOD playlist of a long film is a few hundred KB. */
const PLAYLIST_MAX_CHARS = 8 * 1024 * 1024

export const SESSION_ANSWERS = { answered: 'answered' } as const

/**
 * What the server answered a reopen in place of a session, read off the master once and passed on
 * as it is to every request that was waiting on that reopen.
 */
type SessionAnswer = {
  kind: typeof SESSION_ANSWERS.answered
  status: number
  type: string | null
  text: string
}

/** What a session part's fetch came to: the part's answer, no ticket for the master, or the master's answer. */
export type SessionFetched = Fetched | SessionAnswer

const SESSION_STEPS = { opened: 'opened' } as const

/** What opening a session came to: the session, or what mpv's request gets instead. */
type SessionStep =
  | { kind: typeof SESSION_STEPS.opened; session: HlsSession }
  | TicketFailure
  | SessionAnswer

export const PLAYLIST_ANSWERS = { passed: 'passed', refused: 'refused' } as const

/** A playlist as mpv hears it, rewritten; or refused whole, which mpv hears as a 502. */
type PlaylistAnswer =
  | {
      kind: typeof PLAYLIST_ANSWERS.passed
      status: number
      headers: Record<string, string>
      body: Uint8Array | null
    }
  | { kind: typeof PLAYLIST_ANSWERS.refused }

/** A session the server forgot (it restarted, or let it go) answers 404, or 401 for its key. */
const isLostSession = (status: number): boolean =>
  status === HTTP_STATUSES.notFound || status === HTTP_STATUSES.unauthorized

type FetchPartProps = Omit<RelayRequest, 'path'> & { part: HlsPart }

type PlaylistOfProps = { upstream: Upstream; method: RelayMethod }

export type HlsSessions = {
  /**
   * A part of the load's HLS session, with the session's key. A session the server no longer has
   * is opened again from the master once, and the part asked for in the new one: its segments are
   * cut the same way, so mpv goes on where it was.
   */
  fetchPart: (input: FetchPartProps) => Promise<SessionFetched>
  /** A playlist goes to mpv whole and rewritten, never as the server wrote it. */
  playlistOf: (input: PlaylistOfProps) => Promise<PlaylistAnswer>
}

type CreateHlsSessionsProps = {
  mediaId: number
  /** The server's name, for the warnings. */
  name: string
  /** The load's master playlist, asked with a ticket. */
  fetchMaster: (signal: AbortSignal) => Promise<Fetched>
  /** A path asked of the load's origins as they stand. */
  fetchPath: (request: RelayRequest) => Promise<Upstream>
  /** Aborted as the load retires: it ends a reopen, which is the load's own and no one request's. */
  retired: AbortSignal
  warn: (message: string) => void
}

/**
 * One transcode load's HLS sessions: the session its master opened last, which the playlists it
 * rewrites keep up to date, and the reopen in flight, so the requests that found it lost share one.
 */
export const createHlsSessions = ({
  mediaId,
  name,
  fetchMaster,
  fetchPath,
  retired,
  warn,
}: CreateHlsSessionsProps): HlsSessions => {
  let session: HlsSession | null = null
  let reopening: Promise<SessionStep> | null = null

  /** A playlist rewritten for mpv, keeping the session it names; null for one the relay does not pass on. */
  const readPlaylist = async (upstream: Upstream): Promise<RewrittenPlaylist | null> => {
    const text = await readCapped({
      body: upstream.body,
      maxChars: PLAYLIST_MAX_CHARS,
      onOverflow: OVERFLOWS.refuse,
    }).catch(() => null)
    if (text === null) return null
    const rewritten = rewritePlaylist({ text, mediaId })
    if (rewritten.kind === REWRITE_OUTCOMES.refused) return null
    // A load already retired answers late; nothing reads its session again.
    if (rewritten.session !== null && !retired.aborted) session = rewritten.session
    return rewritten
  }

  /** Asks the master playlist again, with a ticket, for a new session to go on with. */
  const reopen = async (): Promise<SessionStep> => {
    const fetched = await fetchMaster(retired)
    if (fetched.kind !== TICKET_OUTCOMES.ticket) return fetched
    const { upstream } = fetched
    if (!isSuccessStatus(upstream.status)) {
      return {
        kind: SESSION_ANSWERS.answered,
        status: upstream.status,
        type: upstream.headers.get(HTTP_HEADERS.contentType),
        text: await readShort(upstream.body),
      }
    }
    const read = await readPlaylist(upstream)
    if (read === null || read.session === null) {
      warn(`${loggable(name)} sent a master playlist the relay does not pass on`)
      return {
        kind: SESSION_ANSWERS.answered,
        status: HTTP_STATUSES.badGateway,
        type: null,
        text: '',
      }
    }
    return { kind: SESSION_STEPS.opened, session: read.session }
  }

  /** The session to ask: the load's own, unless it is the one found lost, else one reopened. */
  const openSession = (lost: HlsSession | null): Promise<SessionStep> => {
    if (session !== null && session.id !== lost?.id) {
      return Promise.resolve({ kind: SESSION_STEPS.opened, session })
    }
    if (reopening !== null) return reopening
    const step = reopen().finally(() => {
      reopening = null
    })
    reopening = step
    return step
  }

  type FromSessionProps = FetchPartProps & { opened: HlsSession }

  const fromSession = async ({ part, opened, ...request }: FromSessionProps): Promise<Fetched> => ({
    kind: TICKET_OUTCOMES.ticket,
    upstream: await fetchPath({
      ...request,
      path: sessionUrlOf({ mediaId, session: opened, part }),
    }),
  })

  return {
    fetchPart: async (request) => {
      const step = await openSession(null)
      if (step.kind !== SESSION_STEPS.opened) return step
      const fetched = await fromSession({ ...request, opened: step.session })
      if (fetched.kind !== TICKET_OUTCOMES.ticket || !isLostSession(fetched.upstream.status)) {
        return fetched
      }
      await discard(fetched.upstream)
      const again = await openSession(step.session)
      if (again.kind !== SESSION_STEPS.opened) return again
      return fromSession({ ...request, opened: again.session })
    },
    playlistOf: async ({ upstream, method }) => {
      const type = upstream.headers.get(HTTP_HEADERS.contentType)
      const typed: Record<string, string> =
        type === null ? {} : { [HTTP_HEADERS.contentType]: type }
      if (method === RELAY_METHODS.head) {
        await discard(upstream)
        return {
          kind: PLAYLIST_ANSWERS.passed,
          status: upstream.status,
          headers: typed,
          body: null,
        }
      }
      const read = await readPlaylist(upstream)
      if (read === null) {
        warn(`${loggable(name)} sent a playlist the relay does not pass on`)
        return { kind: PLAYLIST_ANSWERS.refused }
      }
      const body = new TextEncoder().encode(read.text)
      return {
        kind: PLAYLIST_ANSWERS.passed,
        status: upstream.status,
        headers: { ...typed, [HTTP_HEADERS.contentLength]: String(body.length) },
        body,
      }
    },
  }
}
