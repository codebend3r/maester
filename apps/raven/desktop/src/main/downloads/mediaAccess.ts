import {
  isMediaId,
  isMediaOrigins,
  isMediaTicket,
  LOCKED_STATUS,
  MEDIA_PROBE_BYTES,
  MEDIA_TICKET_SECONDS,
  toQueryString,
  type MediaOrigin,
  type MediaOriginKind,
} from '@raven/core'
import type { ServerEntry } from '@/main/desktopConfig'
import { DOWNLOAD_MESSAGES } from '@/main/downloads/downloadMessages'
import { EXPAND_MESSAGES } from '@/main/downloads/expand'
import { CALL_MESSAGES, loggable, type ServerCalls } from '@/main/servers/serverCalls'
import { isSidecarTrackId, SERVER_GONE } from '@/shared/protocol'

export const PROBE_TIMEOUT_MS = 2000

/**
 * The furthest off a ticket's expiry may be. Past it, or already past, the server's number is
 * not a ticket's: a renewal timed from it would fire at once, on every fetch, for good.
 */
export const TICKET_HORIZON_MS = 2 * MEDIA_TICKET_SECONDS * 1000

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

export type Access =
  | { kind: 'origin'; url: string; ticket: string; expiresAt: number }
  | { kind: 'cookie' }

export type AccessOutcome =
  | { ok: true; access: Access }
  | { ok: false; reason: 'locked' | 'unreachable' | 'unreadable' | 'gone'; message: string }

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
    case 'origin':
      return `${access.url}/api/media/${mediaId}/${path}?${toQueryString({ t: access.ticket })}`
    case 'cookie':
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
      .call({ serverId: server.id, call: { name: 'getMediaOrigins' } })
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
      call: { name: 'getMediaTicket', mediaId },
    })
    if (!reply.ok) return { ok: false, reason: 'unreachable', message: reply.message }
    if (reply.status === LOCKED_STATUS) {
      return { ok: false, reason: 'locked', message: DOWNLOAD_MESSAGES.relocked(server.name) }
    }
    if (reply.status === NOT_FOUND_STATUS) {
      return { ok: false, reason: 'gone', message: EXPAND_MESSAGES.gone(server.name) }
    }
    // A proxy in front of a restarting server answers 502 to 504: an outage, not a refusal.
    if (reply.status >= 500) {
      return { ok: false, reason: 'unreachable', message: CALL_MESSAGES.unreachable(server.name) }
    }
    const unreadable: AccessOutcome = {
      ok: false,
      reason: 'unreadable',
      message: `${server.name} sent something raven player cannot read.`,
    }
    const body = reply.status === 200 ? readJson(reply.body) : null
    if (!isMediaTicket(body)) return unreadable
    const expiresAt = body.expiresAt * 1000
    const at = now()
    if (!(expiresAt > at && expiresAt <= at + TICKET_HORIZON_MS)) return unreadable
    return {
      ok: true,
      access: { kind: 'origin', url: origin.url, ticket: body.ticket, expiresAt },
    }
  }

  return {
    accessFor: async ({ serverId, mediaId }) => {
      const server = serverOf(serverId)
      if (server === null) return { ok: false, reason: 'unreachable', message: SERVER_GONE }
      const origin = await pickOf(server)
      if (origin === null) return { ok: true, access: { kind: 'cookie' } }
      return ticketAccess({ server, origin, mediaId })
    },
    forget: (serverId) => {
      picks = new Map([...picks].filter(([id]) => id !== serverId))
    },
  }
}
