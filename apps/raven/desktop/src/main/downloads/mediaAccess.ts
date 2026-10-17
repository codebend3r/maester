import {
  isMediaId,
  isMediaOrigins,
  isMediaTicket,
  LOCKED_STATUS,
  MEDIA_PROBE_BYTES,
  toQueryString,
  type MediaOrigin,
  type MediaOriginKind,
} from '@raven/core'
import type { ServerEntry } from '@/main/desktopConfig'
import { loggable, type ServerCalls } from '@/main/servers/serverCalls'
import { isSidecarTrackId, SERVER_GONE } from '@/shared/protocol'

export const PROBE_TIMEOUT_MS = 2000

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
  | { ok: false; reason: 'locked' | 'unreachable' | 'unreadable'; message: string }

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

export const createMediaAccess = ({
  calls,
  serverOf,
  probe,
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

  const pickFor = async (server: ServerEntry): Promise<MediaOrigin | null> => {
    const reply = await calls.call({ serverId: server.id, call: { name: 'getMediaOrigins' } })
    const body = reply.ok && reply.status === 200 ? readJson(reply.body) : null
    if (!isMediaOrigins(body)) {
      warn(`${loggable(server.name)} did not list media origins raven player can read`)
      return null
    }
    const settled = await Promise.allSettled(body.origins.map(probeOne))
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
      return { ok: false, reason: 'locked', message: `${server.name} locked this library again` }
    }
    const body = reply.status === 200 ? readJson(reply.body) : null
    if (!isMediaTicket(body)) {
      return {
        ok: false,
        reason: 'unreadable',
        message: `${server.name} sent something raven player cannot read.`,
      }
    }
    return {
      ok: true,
      access: {
        kind: 'origin',
        url: origin.url,
        ticket: body.ticket,
        expiresAt: body.expiresAt * 1000,
      },
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
