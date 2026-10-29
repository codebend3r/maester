import {
  AUTH_REFUSALS,
  isMediaId,
  isMediaOrigins,
  isSidecarTrackId,
  MEDIA_PROBE_BYTES,
  MEDIA_PROBE_TIMEOUT_MS,
  MEDIA_PURPOSE_PARAM,
  MEDIA_TICKET_PARAM,
  type MediaOrigin,
  type OriginProbe,
  pickOrigin,
  STREAM_PURPOSES,
  toQueryString,
} from '@raven/core'
import { SIGNAL_EVENTS } from '@/main/bounded'
import { SERVER_GONE, type ServerEntry } from '@/main/desktopConfig'
import { accountRefusedMessage, DOWNLOAD_MESSAGES } from '@/main/downloads/downloadMessages'
import { EXPAND_MESSAGES } from '@/main/downloads/expand'
import { quietly } from '@/main/log/quietly'
import { parseJson } from '@/main/parseJson'
import {
  type AccountTickets,
  TICKET_OUTCOMES,
  type TicketOutcome,
} from '@/main/servers/accountTickets'
import { API_PATHS, CALL_NAMES, MEDIA_FILE_PATH, subtitlePathOf } from '@/main/servers/allowlist'
import { CALL_MESSAGES, loggable, type ServerCalls } from '@/main/servers/serverCalls'
import { TIMER_MAX_MS, type Timers } from '@/main/stateStore'
import { HTTP_STATUSES } from '@/shared/httpStatuses'

/**
 * The most account tickets a server's downloads mint in any `windowMs`, a ticket's life on the
 * server. The server keeps 32 live per account, so a fast queue of short files leaves the rest to
 * playback, on every device, rather than spending them all.
 */
export const DOWNLOAD_MINTS = { budget: 16, windowMs: 300_000 } as const

type ProbeFetchProps = {
  url: string
  timeoutMs: number
}

/**
 * Main builds this on `net.fetch`. It owns the timeout, which covers reading the body too: a probe
 * that fails rejects, and one that stalls past the timeout errors its body's read.
 */
export type ProbeFetch = (
  input: ProbeFetchProps,
) => Promise<{ ok: boolean; body: ReadableStream<Uint8Array> | null }>

/**
 * The origin a file is fetched from and the account ticket it goes with. The server checks the
 * ticket only when a request starts, so a long file streams on past its life.
 */
export type Access = { url: string; ticket: string }

export const ACCESS_REFUSALS = {
  locked: 'locked',
  unreachable: 'unreachable',
  gone: 'gone',
  account: 'account',
} as const

export type AccessOutcome =
  | { ok: true; access: Access }
  | { ok: false; reason: (typeof ACCESS_REFUSALS)[keyof typeof ACCESS_REFUSALS]; message: string }

type AccessForProps = {
  serverId: string
  mediaId: number
  signal: AbortSignal
}

export type MediaAccess = {
  /** `signal` is the run's: a run stopped while it waits on the mint budget mints nothing. */
  accessFor: (input: AccessForProps) => Promise<AccessOutcome>
  forget: (serverId: string) => void
}

type MeasureOriginProps = {
  origin: MediaOrigin
  probe: ProbeFetch
  clock: () => number
}

/**
 * Times the whole ping body as the web player's probe does: the first byte from the call, then the
 * body's bytes over the time from its first byte to its last. Null for an answer that is not 2xx or
 * whose body ends short of `MEDIA_PROBE_BYTES`; it rejects when the fetch fails or times out.
 */
const measureOrigin = async ({
  origin,
  probe,
  clock,
}: MeasureOriginProps): Promise<OriginProbe | null> => {
  const url = `${origin.url}/api/media-origins/ping?${toQueryString({ bytes: String(MEDIA_PROBE_BYTES) })}`
  const startedAt = clock()
  const response = await probe({ url, timeoutMs: MEDIA_PROBE_TIMEOUT_MS })
  if (response.body === null) return null
  const reader = response.body.getReader()
  const countFrom = async (received: number): Promise<number> => {
    const { done, value } = await reader.read()
    if (done) return received
    return countFrom(received + value.length)
  }
  try {
    if (!response.ok) return null
    const first = await reader.read()
    const firstByteAt = clock()
    if (first.done) return null
    const received = await countFrom(first.value.length)
    const doneAt = clock()
    if (received < MEDIA_PROBE_BYTES) return null
    // A body that lands in one read has no measurable transfer time; a millisecond keeps the rate finite.
    const measuredMs = doneAt - firstByteAt
    const transferMs = measuredMs > 0 ? measuredMs : 1
    return {
      origin,
      firstByteMs: firstByteAt - startedAt,
      bytesPerSecond: received / (transferMs / 1000),
    }
  } finally {
    // Lets go of a body left unread or broken off; one read to its end has nothing left to cancel.
    await reader.cancel().catch(() => undefined)
  }
}

type MediaUrlForProps = {
  access: Access
  mediaId: number
  path: string
  query?: Record<string, string>
}

const mediaUrlFor = ({ access, mediaId, path, query = {} }: MediaUrlForProps): string => {
  if (!isMediaId(mediaId)) throw new RangeError('A download needs a media id')
  return `${access.url}${API_PATHS.media}/${mediaId}/${path}?${toQueryString({ [MEDIA_TICKET_PARAM]: access.ticket, ...query })}`
}

type FileUrlForProps = { access: Access; mediaId: number }

/** Names itself a download, so the server's Streams page lists it apart from what is being watched. */
export const fileUrlFor = ({ access, mediaId }: FileUrlForProps): string =>
  mediaUrlFor({
    access,
    mediaId,
    path: MEDIA_FILE_PATH,
    query: { [MEDIA_PURPOSE_PARAM]: STREAM_PURPOSES.download },
  })

type SidecarUrlForProps = {
  access: Access
  mediaId: number
  trackId: string
}

export const sidecarUrlFor = ({ access, mediaId, trackId }: SidecarUrlForProps): string => {
  if (!isSidecarTrackId(trackId)) throw new RangeError('A subtitle needs an external track id')
  return mediaUrlFor({ access, mediaId, path: subtitlePathOf(trackId) })
}

/**
 * The origin a server listed, cut down to scheme, host and port, or null when it is
 * not a plain http or https address: `net.fetch` also reads `file:`, so the server's
 * word is never taken as it comes.
 */
const trustedOrigin = (origin: MediaOrigin): MediaOrigin | null => {
  try {
    const url = new URL(origin.url)
    const isWeb = url.protocol === 'http:' || url.protocol === 'https:'
    if (!isWeb || url.username !== '' || url.password !== '') return null
    return { kind: origin.kind, url: url.origin }
  } catch {
    return null
  }
}

type MintRefusalOfProps = {
  outcome: Exclude<TicketOutcome, { kind: typeof TICKET_OUTCOMES.ticket }>
  server: ServerEntry
}

/** What a mint that gave no ticket comes to, in the refusals the queue already knows. */
const mintRefusalOf = ({ outcome, server }: MintRefusalOfProps): AccessOutcome => {
  switch (outcome.kind) {
    case TICKET_OUTCOMES.refused:
      // Accounts that are down, or a server at its ticket cap, is an outage the retry outlasts.
      if (outcome.reason === AUTH_REFUSALS.unavailable) {
        return {
          ok: false,
          reason: ACCESS_REFUSALS.unreachable,
          message: CALL_MESSAGES.unreachable(server.name),
        }
      }
      return {
        ok: false,
        reason: ACCESS_REFUSALS.account,
        message: accountRefusedMessage({ reason: outcome.reason, serverName: server.name }),
      }
    case TICKET_OUTCOMES.locked:
      return {
        ok: false,
        reason: ACCESS_REFUSALS.locked,
        message: DOWNLOAD_MESSAGES.relocked(server.name),
      }
    case TICKET_OUTCOMES.gone:
      return { ok: false, reason: ACCESS_REFUSALS.gone, message: EXPAND_MESSAGES.gone(server.name) }
    case TICKET_OUTCOMES.unreachable:
      return {
        ok: false,
        reason: ACCESS_REFUSALS.unreachable,
        message: CALL_MESSAGES.unreachable(server.name),
      }
    default: {
      const unreachable: never = outcome
      return unreachable
    }
  }
}

type CreateMediaAccessProps = {
  calls: Pick<ServerCalls, 'call'>
  serverOf: (serverId: string) => ServerEntry | null
  probe: ProbeFetch
  probeClock: () => number
  now: () => number
  timers: Timers
  tickets: Pick<AccountTickets, 'ticketFor'>
  warn: (message: string) => void
}

/**
 * Each run reaches the server with an account ticket minted for it, on the media origin the probes
 * pick. `probeClock` times the probes in monotonic milliseconds, so a wall clock that jumps never
 * skews one; `now` is the wall clock the mint budget is kept by.
 */
export const createMediaAccess = ({
  calls,
  serverOf,
  probe,
  probeClock,
  now,
  timers,
  tickets,
  warn,
}: CreateMediaAccessProps): MediaAccess => {
  /** The pick is held as a promise so two files asking at once share one read and one probe. */
  let picks: ReadonlyMap<string, Promise<MediaOrigin | null>> = new Map()

  /** A log line never fails an access: the pick it belongs to is held for good. */
  const safeWarn = quietly(warn)

  /** Never rejects: a pick is held for good, so a rejected one would fail every later call. */
  const pickFor = async (server: ServerEntry): Promise<MediaOrigin | null> => {
    const reply = await calls
      .call({ serverId: server.id, call: { name: CALL_NAMES.getMediaOrigins } })
      .catch(() => null)
    const body =
      reply !== null && reply.ok && reply.status === HTTP_STATUSES.ok ? parseJson(reply.body) : null
    if (!isMediaOrigins(body)) {
      safeWarn(`${loggable(server.name)} did not list media origins Raven can read`)
      return null
    }
    const checked = body.origins.map((origin) => ({
      kind: origin.kind,
      trusted: trustedOrigin(origin),
    }))
    const refused = checked.filter((entry) => entry.trusted === null).map((entry) => entry.kind)
    if (refused.length > 0) {
      safeWarn(
        `${loggable(server.name)} listed media origins Raven does not trust: ${refused.join(', ')}`,
      )
    }
    const settled = await Promise.allSettled(
      checked.flatMap((entry) =>
        entry.trusted === null
          ? []
          : [measureOrigin({ origin: entry.trusted, probe, clock: probeClock })],
      ),
    )
    return pickOrigin(
      settled.flatMap((result) =>
        result.status === 'fulfilled' && result.value !== null ? [result.value] : [],
      ),
    )
  }

  const pickOf = (server: ServerEntry): Promise<MediaOrigin | null> => {
    const held = picks.get(server.id)
    if (held !== undefined) return held
    const pick = pickFor(server)
    picks = new Map([...picks, [server.id, pick]])
    return pick
  }

  /** When each server's downloads minted, by Raven's clock, inside the last window. */
  let minted: ReadonlyMap<string, readonly number[]> = new Map()

  type WaitForProps = { ms: number; signal: AbortSignal }

  /** True once `ms` has passed, false as soon as `signal` aborts. */
  const waitFor = ({ ms, signal }: WaitForProps): Promise<boolean> =>
    new Promise((resolve) => {
      const timer: { handle: unknown } = { handle: undefined }
      const onAbort = (): void => {
        timers.clear(timer.handle)
        resolve(false)
      }
      timer.handle = timers.set({
        run: () => {
          signal.removeEventListener(SIGNAL_EVENTS.abort, onAbort)
          resolve(true)
        },
        ms: Math.min(ms, TIMER_MAX_MS),
      })
      signal.addEventListener(SIGNAL_EVENTS.abort, onAbort, { once: true })
    })

  type TakeMintProps = {
    serverId: string
    signal: AbortSignal
  }

  /**
   * Takes one of the server's mints, waiting while the window's are spent until the oldest ages
   * out. False when the run stopped first, and nothing was taken.
   */
  const takeMint = async ({ serverId, signal }: TakeMintProps): Promise<boolean> => {
    if (signal.aborted) return false
    const time = now()
    const recent = (minted.get(serverId) ?? []).filter(
      (at) => at > time - DOWNLOAD_MINTS.windowMs && at <= time,
    )
    if (recent.length < DOWNLOAD_MINTS.budget) {
      minted = new Map([...minted, [serverId, [...recent, time]]])
      return true
    }
    // A clock set back never waits longer than one window.
    const ms = Math.min(
      Math.max(Math.min(...recent) + DOWNLOAD_MINTS.windowMs - time, 1),
      DOWNLOAD_MINTS.windowMs,
    )
    return (await waitFor({ ms, signal })) && takeMint({ serverId, signal })
  }

  type AccountAccessProps = {
    server: ServerEntry
    mediaId: number
    signal: AbortSignal
  }

  /** The picked origin, or the server's own when none answers, with a ticket minted fresh. */
  const accountAccess = async ({
    server,
    mediaId,
    signal,
  }: AccountAccessProps): Promise<AccessOutcome> => {
    // The queue has already let go of a stopped run, so what this answers is never read.
    if (!(await takeMint({ serverId: server.id, signal }))) {
      return {
        ok: false,
        reason: ACCESS_REFUSALS.unreachable,
        message: CALL_MESSAGES.unreachable(server.name),
      }
    }
    const [origin, outcome] = await Promise.all([
      pickOf(server),
      tickets.ticketFor({ serverId: server.id, mediaId, isFresh: true }),
    ])
    if (outcome.kind !== TICKET_OUTCOMES.ticket) return mintRefusalOf({ outcome, server })
    return { ok: true, access: { url: origin?.url ?? server.origin, ticket: outcome.ticket } }
  }

  return {
    accessFor: async ({ serverId, mediaId, signal }) => {
      const server = serverOf(serverId)
      if (server === null)
        return { ok: false, reason: ACCESS_REFUSALS.unreachable, message: SERVER_GONE }
      return accountAccess({ server, mediaId, signal })
    },
    forget: (serverId) => {
      picks = new Map([...picks].filter(([id]) => id !== serverId))
    },
  }
}
