import {
  AUTH_REFUSALS,
  isMediaId,
  isMediaOrigins,
  isMediaTicket,
  LOCKED_STATUS,
  MEDIA_PROBE_BYTES,
  MEDIA_TICKET_PARAM,
  MEDIA_TICKET_REFRESH_SECONDS,
  MEDIA_TICKET_SECONDS,
  pickOrigin,
  toQueryString,
  type MediaOrigin,
  type OriginProbe,
} from '@raven/core'
import { SIGNAL_EVENTS } from '@/main/bounded'
import type { ServerEntry } from '@/main/desktopConfig'
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
import { isSidecarTrackId, SERVER_GONE } from '@/shared/protocol'

export const PROBE_TIMEOUT_MS = 2000

/**
 * How long after it was read a ticket is renewed, as the web player does: timed from the read by
 * raven player's own clock, never from `expiresAt`, so a clock off the server's changes nothing.
 */
export const TICKET_RENEW_MS = (MEDIA_TICKET_SECONDS - MEDIA_TICKET_REFRESH_SECONDS) * 1000

/**
 * The most account tickets a server's downloads mint in any `windowMs`, a ticket's life on the
 * server. The server keeps 32 live per account, so a fast queue of short files leaves the rest to
 * playback, on every device, rather than spending them all.
 */
export const DOWNLOAD_MINTS = { budget: 16, windowMs: 300_000 } as const

/**
 * Main builds this on `net.fetch`. It owns the timeout, which covers reading the body too: a probe
 * that fails rejects, and one that stalls past the timeout errors its body's read.
 */
export type ProbeFetch = (input: {
  url: string
  timeoutMs: number
}) => Promise<{ ok: boolean; body: ReadableStream<Uint8Array> | null }>

export const ACCESS_KINDS = { origin: 'origin', cookie: 'cookie', account: 'account' } as const

/**
 * `renewAt` is when the queue reads a new ticket, in epoch ms by raven player's clock. An account
 * ticket has none: the server checks it only when a request starts, so a long file streams on.
 */
export type Access =
  | { kind: typeof ACCESS_KINDS.origin; url: string; ticket: string; renewAt: number }
  | { kind: typeof ACCESS_KINDS.cookie }
  | { kind: typeof ACCESS_KINDS.account; url: string; ticket: string }

export const ACCESS_REFUSALS = {
  locked: 'locked',
  unreachable: 'unreachable',
  unreadable: 'unreadable',
  gone: 'gone',
  account: 'account',
} as const

export type AccessOutcome =
  | { ok: true; access: Access }
  | { ok: false; reason: (typeof ACCESS_REFUSALS)[keyof typeof ACCESS_REFUSALS]; message: string }

export type MediaAccess = {
  /** `signal` is the run's: a run stopped while it waits on the mint budget mints nothing. */
  accessFor: (input: {
    serverId: string
    mediaId: number
    signal: AbortSignal
  }) => Promise<AccessOutcome>
  forget: (serverId: string) => void
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
}: {
  origin: MediaOrigin
  probe: ProbeFetch
  clock: () => number
}): Promise<OriginProbe | null> => {
  const url = `${origin.url}/api/media-origins/ping?${toQueryString({ bytes: String(MEDIA_PROBE_BYTES) })}`
  const startedAt = clock()
  const response = await probe({ url, timeoutMs: PROBE_TIMEOUT_MS })
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

const mediaUrlFor = ({
  access,
  origin,
  mediaId,
  path,
}: {
  access: Access
  origin: string
  mediaId: number
  path: string
}): string => {
  if (!isMediaId(mediaId)) throw new RangeError('A download needs a media id')
  switch (access.kind) {
    case ACCESS_KINDS.origin:
    case ACCESS_KINDS.account:
      return `${access.url}${API_PATHS.media}/${mediaId}/${path}?${toQueryString({ [MEDIA_TICKET_PARAM]: access.ticket })}`
    case ACCESS_KINDS.cookie:
      return `${origin}${API_PATHS.media}/${mediaId}/${path}`
    default: {
      const unreachable: never = access
      return unreachable
    }
  }
}

export const fileUrlFor = ({
  access,
  origin,
  mediaId,
}: {
  access: Access
  origin: string
  mediaId: number
}): string => mediaUrlFor({ access, origin, mediaId, path: MEDIA_FILE_PATH })

export const sidecarUrlFor = ({
  access,
  origin,
  mediaId,
  trackId,
}: {
  access: Access
  origin: string
  mediaId: number
  trackId: string
}): string => {
  if (!isSidecarTrackId(trackId)) throw new RangeError('A subtitle needs an external track id')
  return mediaUrlFor({ access, origin, mediaId, path: subtitlePathOf(trackId) })
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

/** What a mint that gave no ticket comes to, in the refusals the queue already knows. */
const mintRefusalOf = ({
  outcome,
  server,
}: {
  outcome: Exclude<TicketOutcome, { kind: typeof TICKET_OUTCOMES.ticket }>
  server: ServerEntry
}): AccessOutcome => {
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

/**
 * `probeClock` times the probes in monotonic milliseconds, so a wall clock that jumps never skews
 * one; `now` is the wall clock a ticket's renewal is set by. A server whose accounts are ready
 * (`isReady`, read as playback reads it) is reached with an account ticket minted for each run.
 */
export const createMediaAccess = ({
  calls,
  serverOf,
  probe,
  probeClock,
  now,
  timers,
  isReady,
  tickets,
  warn,
}: {
  calls: Pick<ServerCalls, 'call'>
  serverOf: (serverId: string) => ServerEntry | null
  probe: ProbeFetch
  probeClock: () => number
  now: () => number
  timers: Timers
  isReady: (server: ServerEntry) => Promise<boolean>
  tickets: Pick<AccountTickets, 'ticketFor'>
  warn: (message: string) => void
}): MediaAccess => {
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
      safeWarn(`${loggable(server.name)} did not list media origins raven player can read`)
      return null
    }
    const checked = body.origins.map((origin) => ({
      kind: origin.kind,
      trusted: trustedOrigin(origin),
    }))
    const refused = checked.filter((entry) => entry.trusted === null).map((entry) => entry.kind)
    if (refused.length > 0) {
      safeWarn(
        `${loggable(server.name)} listed media origins raven player does not trust: ${refused.join(', ')}`,
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

  const ticketAccess = async ({
    server,
    origin,
    mediaId,
  }: {
    server: ServerEntry
    origin: MediaOrigin
    mediaId: number
  }): Promise<AccessOutcome> => {
    const reply = await calls.call({
      serverId: server.id,
      call: { name: CALL_NAMES.getMediaTicket, mediaId },
    })
    if (!reply.ok) return { ok: false, reason: ACCESS_REFUSALS.unreachable, message: reply.message }
    if (reply.status === LOCKED_STATUS) {
      return {
        ok: false,
        reason: ACCESS_REFUSALS.locked,
        message: DOWNLOAD_MESSAGES.relocked(server.name),
      }
    }
    if (reply.status === HTTP_STATUSES.notFound) {
      return { ok: false, reason: ACCESS_REFUSALS.gone, message: EXPAND_MESSAGES.gone(server.name) }
    }
    // A proxy in front of a restarting server answers 502 to 504: an outage, not a refusal.
    if (reply.status >= 500) {
      return {
        ok: false,
        reason: ACCESS_REFUSALS.unreachable,
        message: CALL_MESSAGES.unreachable(server.name),
      }
    }
    const body = reply.status === HTTP_STATUSES.ok ? parseJson(reply.body) : null
    if (!isMediaTicket(body)) {
      return {
        ok: false,
        reason: ACCESS_REFUSALS.unreadable,
        message: `${server.name} sent something raven player cannot read.`,
      }
    }
    return {
      ok: true,
      access: {
        kind: ACCESS_KINDS.origin,
        url: origin.url,
        ticket: body.ticket,
        renewAt: now() + TICKET_RENEW_MS,
      },
    }
  }

  /** When each server's downloads minted, by raven player's clock, inside the last window. */
  let minted: ReadonlyMap<string, readonly number[]> = new Map()

  /** True once `ms` has passed, false as soon as `signal` aborts. */
  const waitFor = ({ ms, signal }: { ms: number; signal: AbortSignal }): Promise<boolean> =>
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

  /**
   * Takes one of the server's mints, waiting while the window's are spent until the oldest ages
   * out. False when the run stopped first, and nothing was taken.
   */
  const takeMint = async ({
    serverId,
    signal,
  }: {
    serverId: string
    signal: AbortSignal
  }): Promise<boolean> => {
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

  /** The picked origin, or the server's own when none answers, with a ticket minted fresh. */
  const accountAccess = async ({
    server,
    mediaId,
    signal,
  }: {
    server: ServerEntry
    mediaId: number
    signal: AbortSignal
  }): Promise<AccessOutcome> => {
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
    return {
      ok: true,
      access: {
        kind: ACCESS_KINDS.account,
        url: origin?.url ?? server.origin,
        ticket: outcome.ticket,
      },
    }
  }

  return {
    accessFor: async ({ serverId, mediaId, signal }) => {
      const server = serverOf(serverId)
      if (server === null)
        return { ok: false, reason: ACCESS_REFUSALS.unreachable, message: SERVER_GONE }
      if (await isReady(server)) return accountAccess({ server, mediaId, signal })
      const origin = await pickOf(server)
      if (origin === null) return { ok: true, access: { kind: ACCESS_KINDS.cookie } }
      return ticketAccess({ server, origin, mediaId })
    },
    forget: (serverId) => {
      picks = new Map([...picks].filter(([id]) => id !== serverId))
    },
  }
}
