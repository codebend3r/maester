import {
  isMediaId,
  isMediaOrigins,
  isMediaTicket,
  LOCKED_STATUS,
  MEDIA_PROBE_BYTES,
  MEDIA_TICKET_REFRESH_SECONDS,
  MEDIA_TICKET_SECONDS,
  toQueryString,
  type MediaOrigin,
  type MediaOriginKind,
} from '@raven/core'
import type { ServerEntry } from '@/main/desktopConfig'
import { DOWNLOAD_MESSAGES } from '@/main/downloads/downloadMessages'
import { EXPAND_MESSAGES } from '@/main/downloads/expand'
import { CALL_NAMES } from '@/main/servers/allowlist'
import { CALL_MESSAGES, loggable, type ServerCalls } from '@/main/servers/serverCalls'
import { isSidecarTrackId, SERVER_GONE } from '@/shared/protocol'

export const PROBE_TIMEOUT_MS = 2000

/**
 * How long after it was read a ticket is renewed, as the web player does: timed from the read by
 * raven player's own clock, never from `expiresAt`, so a clock off the server's changes nothing.
 */
export const TICKET_RENEW_MS = (MEDIA_TICKET_SECONDS - MEDIA_TICKET_REFRESH_SECONDS) * 1000

const NOT_FOUND_STATUS = 404

/** The nearer the origin, the lower the rank, and the lower rank wins the pick. */
export const ORIGIN_KIND_RANK = { lan: 0, tailnet: 1, public: 2 } as const satisfies Record<
  MediaOriginKind,
  number
>

/** Main builds this on `net.fetch`; it owns the timeout, and a probe that fails or times out rejects. */
export type ProbeFetch = (input: {
  url: string
  timeoutMs: number
}) => Promise<{ status: number; firstByteMs: number }>

export const ACCESS_KINDS = { origin: 'origin', cookie: 'cookie' } as const

/** `renewAt` is when the queue reads a new ticket, in epoch ms by raven player's clock. */
export type Access =
  | { kind: typeof ACCESS_KINDS.origin; url: string; ticket: string; renewAt: number }
  | { kind: typeof ACCESS_KINDS.cookie }

export const ACCESS_REFUSALS = {
  locked: 'locked',
  unreachable: 'unreachable',
  unreadable: 'unreadable',
  gone: 'gone',
} as const

export type AccessOutcome =
  | { ok: true; access: Access }
  | { ok: false; reason: (typeof ACCESS_REFUSALS)[keyof typeof ACCESS_REFUSALS]; message: string }

export type MediaAccess = {
  accessFor: (input: { serverId: string; mediaId: number }) => Promise<AccessOutcome>
  forget: (serverId: string) => void
}

type Probe = { origin: MediaOrigin; status: number; firstByteMs: number }

/** The origin to fetch from: of those that answered 200, the nearest kind, then the quickest first byte. */
export const pickReachable = (probes: readonly Probe[]): MediaOrigin | null =>
  probes
    .filter((probe) => probe.status === 200)
    .toSorted(
      (a, b) =>
        ORIGIN_KIND_RANK[a.origin.kind] - ORIGIN_KIND_RANK[b.origin.kind] ||
        a.firstByteMs - b.firstByteMs,
    )[0]?.origin ?? null

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
      return `${access.url}/api/media/${mediaId}/${path}?${toQueryString({ t: access.ticket })}`
    case ACCESS_KINDS.cookie:
      return `${origin}/api/media/${mediaId}/${path}`
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
}): string => mediaUrlFor({ access, origin, mediaId, path: 'file' })

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
  return mediaUrlFor({ access, origin, mediaId, path: `subtitles/${trackId}` })
}

const readJson = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
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

export const createMediaAccess = ({
  calls,
  serverOf,
  probe,
  now,
  warn,
}: {
  calls: Pick<ServerCalls, 'call'>
  serverOf: (serverId: string) => ServerEntry | null
  probe: ProbeFetch
  now: () => number
  warn: (message: string) => void
}): MediaAccess => {
  /** The pick is held as a promise so two files asking at once share one read and one probe. */
  let picks: ReadonlyMap<string, Promise<MediaOrigin | null>> = new Map()

  const probeOne = async (origin: MediaOrigin): Promise<Probe> => {
    const url = `${origin.url}/api/media-origins/ping?${toQueryString({ bytes: String(MEDIA_PROBE_BYTES) })}`
    const answer = await probe({ url, timeoutMs: PROBE_TIMEOUT_MS })
    return { origin, ...answer }
  }

  /** A log line never fails an access: the pick it belongs to is held for good. */
  const safeWarn = (message: string): void => {
    try {
      warn(message)
    } catch {
      // Nothing is left to tell.
    }
  }

  /** Never rejects: a pick is held for good, so a rejected one would fail every later call. */
  const pickFor = async (server: ServerEntry): Promise<MediaOrigin | null> => {
    const reply = await calls
      .call({ serverId: server.id, call: { name: CALL_NAMES.getMediaOrigins } })
      .catch(() => null)
    const body = reply?.ok && reply.status === 200 ? readJson(reply.body) : null
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
      checked.flatMap((entry) => (entry.trusted === null ? [] : [probeOne(entry.trusted)])),
    )
    return pickReachable(
      settled.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : [])),
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
    if (reply.status === NOT_FOUND_STATUS) {
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
    const body = reply.status === 200 ? readJson(reply.body) : null
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

  return {
    accessFor: async ({ serverId, mediaId }) => {
      const server = serverOf(serverId)
      if (server === null)
        return { ok: false, reason: ACCESS_REFUSALS.unreachable, message: SERVER_GONE }
      const origin = await pickOf(server)
      if (origin === null) return { ok: true, access: { kind: ACCESS_KINDS.cookie } }
      return ticketAccess({ server, origin, mediaId })
    },
    forget: (serverId) => {
      picks = new Map([...picks].filter(([id]) => id !== serverId))
    },
  }
}
