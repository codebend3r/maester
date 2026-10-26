import {
  ACCESS_REFUSALS,
  APP_CALL_METHODS,
  type AccessRefusal,
  type AccessRefusalReason,
  ApiError,
  type ApiClient,
  LOCKED_STATUS,
  MEDIA_ORIGIN_KINDS,
  MEDIA_PROBE_BYTES,
  MEDIA_PROBE_TIMEOUT_MS,
  type MaxHeight,
  type MediaAccess,
  type MediaItem,
  type MediaOrigin,
  type OriginProbe,
  PLAYBACK_MODES,
  type PlaybackMode,
  STREAM_QUALITIES,
  type StreamQuality,
  isStreamQuality,
  pickOrigin,
  serverOriginOf,
  ticketRenewAt,
} from '@raven/core'

import { checkAppCall } from '@/servers/allowlist'
import type { ServerCookies } from '@/servers/cookieJar'
import { cookieHeadersFor } from '@/servers/serverHeaders'
import type { AppServer } from '@/servers/serverList'
import { TICKETS_OFF_STATUS } from '@/servers/tickets'

type ProbeFetchProps = {
  url: string
  timeoutMs: number
}

/**
 * One origin's ping, read to its end within `timeoutMs`: whether it answered 2xx, how many bytes
 * came, and how long the whole of it took. React Native's `fetch` hands a response over only once
 * its body has arrived, so the wait for the first byte cannot be told apart from the transfer.
 */
export type ProbeFetch = (
  input: ProbeFetchProps,
) => Promise<{ ok: boolean; bytes: number; elapsedMs: number }>

type WatchNetworkProps = { onChange: () => void }

/** Calls `onChange` whenever the device moves to another network, until the returned stop is called. */
export type WatchNetwork = (input: WatchNetworkProps) => () => void

/** What the native player is given: the address it loads and the headers it sends with each request. */
type PlayerSource = { uri: string; headers: Record<string, string> }

export type SourceOutcome = { ok: true; source: PlayerSource } | AccessRefusal

/** A video to play and how: direct is the file itself, remux and transcode the HLS master playlist. */
export type SourceRequest = {
  media: Pick<MediaItem, 'id'>
  mode: PlaybackMode
  audio: number | null
}

/**
 * The size a transcode away from home asks for. The server takes no height, only one of
 * `STREAM_QUALITIES`, and sizes only a transcode (a remux copies the video). The cap is there to
 * save data, so it is the size at that height with the fewest bits, never more than the server's
 * own quality setting would spend. A cap no size is as tall as (4K: the sizes stop at 1080p) asks
 * for none, and the server's own settings stand.
 */
const awayQualityOf = (maxHeight: MaxHeight): StreamQuality | null =>
  isStreamQuality.values
    .filter((key) => STREAM_QUALITIES[key].height === maxHeight)
    .toSorted((a, b) => STREAM_QUALITIES[a].bitrate - STREAM_QUALITIES[b].bitrate)[0] ?? null

export type MediaSources = {
  source: (request: SourceRequest) => Promise<SourceOutcome>
  /** Stops watching the network. */
  close: () => void
}

export const MEDIA_ACCESS_MESSAGES = {
  locked: (name: string): string => `This video's library on ${name} is locked.`,
  gone: (name: string): string => `${name} no longer has this video.`,
  unreachable: (name: string): string => `${name} can't be reached.`,
  unreadable: (name: string): string => `${name} sent something raven can't read.`,
  account: (name: string): string => `${name} signs in with accounts, which the app can't do yet.`,
} as const satisfies Record<AccessRefusalReason, (name: string) => string>

const NOT_FOUND_STATUS = 404
const SERVER_ERROR_STATUS = 500

const TICKET_READS = { issued: 'issued', off: 'off', refused: 'refused' } as const

type HeldTicket = { ticket: string; renewAt: number }

type TicketRead =
  | ({ kind: typeof TICKET_READS.issued } & HeldTicket)
  | { kind: typeof TICKET_READS.off }
  | { kind: typeof TICKET_READS.refused; refusal: AccessRefusal }

type AccessRefusalProps = {
  reason: AccessRefusalReason
  server: AppServer
}

const accessRefusal = ({ reason, server }: AccessRefusalProps): AccessRefusal => ({
  ok: false,
  reason,
  message: MEDIA_ACCESS_MESSAGES[reason](server.name),
})

type RefusalOfProps = { error: unknown; server: AppServer }

const refusalOf = ({ error, server }: RefusalOfProps): TicketRead => {
  const refused = (reason: AccessRefusalReason): TicketRead => ({
    kind: TICKET_READS.refused,
    refusal: accessRefusal({ reason, server }),
  })
  // Anything but the server's own answer, a failed network above all, is an outage.
  if (!(error instanceof ApiError)) return refused(ACCESS_REFUSALS.unreachable)
  if (error.status === TICKETS_OFF_STATUS) return { kind: TICKET_READS.off }
  if (error.status === LOCKED_STATUS) return refused(ACCESS_REFUSALS.locked)
  if (error.status === NOT_FOUND_STATUS) return refused(ACCESS_REFUSALS.gone)
  // A proxy in front of a restarting server answers 502 or 504.
  if (error.status >= SERVER_ERROR_STATUS) return refused(ACCESS_REFUSALS.unreachable)
  return refused(ACCESS_REFUSALS.unreadable)
}

type MediaAccessForProps = {
  api: ApiClient
  server: AppServer
  now: () => number
  probe: ProbeFetch
  readCookies: () => Promise<ServerCookies>
  /** The account's token, sent beside the cookies when the app plays from the server's own address. */
  readAccessToken?: () => string | null
  watchNetwork: WatchNetwork
  awayMaxHeight: () => MaxHeight
}

/**
 * Where one server's videos play from, for the native players. The origins `getMediaOrigins`
 * lists are probed on first use and again on each change of network, and the fastest by core's
 * `pickOrigin` plays by ticket. A probe that picks none is not kept: the next source probes
 * again, so an origin that comes back is used without waiting for the network to change. A
 * ticket is read per video and renewed `MEDIA_TICKET_RENEW_MS` after it was read, by `now`. A
 * server that lists no origin, has none answering, or hands out no ticket (the 503 of one
 * without `RAVEN_MEDIA_SECRET`) plays from its own address with its cookies as headers, which
 * `cookieHeadersFor` gives only to its own API. A transcode from the `public` origin, away
 * from home, asks for the size `awayMaxHeight` reads at the moment, Settings' cap. Nothing here
 * logs: a ticket is only ever in the source's address.
 */
export const mediaAccessFor = ({
  api,
  server,
  now,
  probe,
  readCookies,
  readAccessToken = () => null,
  watchNetwork,
  awayMaxHeight,
}: MediaAccessForProps): MediaSources => {
  /** Held as a promise, so sources asked for at once share one read and one probe. */
  let pick: Promise<MediaOrigin | null> | null = null
  let held: ReadonlyMap<number, HeldTicket> = new Map()
  let reading: ReadonlyMap<number, Promise<TicketRead>> = new Map()

  const measure = async (origin: MediaOrigin): Promise<OriginProbe | null> => {
    try {
      const answer = await probe({
        url: api.pingUrl({ origin }),
        timeoutMs: MEDIA_PROBE_TIMEOUT_MS,
      })
      if (!answer.ok || answer.bytes < MEDIA_PROBE_BYTES) return null
      // A ping that lands within the clock's tick has no measurable time; a millisecond keeps the rate finite.
      const elapsedMs = Math.max(answer.elapsedMs, 1)
      return { origin, firstByteMs: elapsedMs, bytesPerSecond: answer.bytes / (elapsedMs / 1000) }
    } catch {
      return null
    }
  }

  /** Never rejects: a server that lists nothing readable, or whose origins all fail, picks none. */
  const pickFor = async (): Promise<MediaOrigin | null> => {
    const listed = await api.getMediaOrigins().then(
      ({ origins }) => origins,
      (): MediaOrigin[] => [],
    )
    // The server's word is never taken as it comes: React Native's `fetch` reads `file:` too.
    const trusted = listed.flatMap((origin) => {
      const url = serverOriginOf(origin.url)
      return url === null ? [] : [{ kind: origin.kind, url }]
    })
    const probes = await Promise.all(trusted.map(measure))
    return pickOrigin(probes.filter((each) => each !== null))
  }

  /** A fresh pick to hold, let go of once it turns out to be none, so the next source asks again. */
  const freshPick = (): Promise<MediaOrigin | null> => {
    const next: Promise<MediaOrigin | null> = pickFor().then((origin) => {
      if (origin === null && pick === next) pick = null
      return origin
    })
    return next
  }

  const pickOf = (): Promise<MediaOrigin | null> => {
    pick ??= freshPick()
    return pick
  }

  const stopWatching = watchNetwork({
    onChange: () => {
      if (pick !== null) pick = freshPick()
    },
  })

  const readTicket = (mediaId: number): Promise<TicketRead> => {
    const pending = reading.get(mediaId)
    if (pending !== undefined) return pending
    const read = api
      .getMediaTicket(mediaId)
      .then(
        ({ ticket }): TicketRead => {
          const readAt = now()
          const fresh = { ticket, renewAt: ticketRenewAt({ readAt }) }
          // A ticket past its renewal is never used again, so it goes as another comes.
          const live = [...held].filter(([, kept]) => readAt < kept.renewAt)
          held = new Map([...live, [mediaId, fresh]])
          return { kind: TICKET_READS.issued, ...fresh }
        },
        (error: unknown) => refusalOf({ error, server }),
      )
      .finally(() => {
        reading = new Map([...reading].filter(([id]) => id !== mediaId))
      })
    reading = new Map([...reading, [mediaId, read]])
    return read
  }

  const ticketFor = async (mediaId: number): Promise<TicketRead> => {
    const ticket = held.get(mediaId)
    if (ticket !== undefined && now() < ticket.renewAt)
      return { kind: TICKET_READS.issued, ...ticket }
    return readTicket(mediaId)
  }

  /** A transcode's size: capped away from home, from the `public` origin, and else the server's. */
  const transcodeQualityOf = (access: MediaAccess | null): StreamQuality | null =>
    access !== null && access.origin.kind === MEDIA_ORIGIN_KINDS.public
      ? awayQualityOf(awayMaxHeight())
      : null

  type UriForProps = {
    request: SourceRequest
    access: MediaAccess | null
  }

  const uriFor = ({ request: { media, mode, audio }, access }: UriForProps): string => {
    switch (mode) {
      case PLAYBACK_MODES.direct:
        return api.fileUrl({ id: media.id, access })
      case PLAYBACK_MODES.remux:
        return api.hlsUrl({ id: media.id, mode, audio, quality: null, access })
      case PLAYBACK_MODES.transcode:
        return api.hlsUrl({
          id: media.id,
          mode,
          audio,
          quality: transcodeQualityOf(access),
          access,
        })
      default: {
        const unreachable: never = mode
        return unreachable
      }
    }
  }

  const cookieSource = async (request: SourceRequest): Promise<SourceOutcome> => {
    const uri = uriFor({ request, access: null })
    const headers = cookieHeadersFor({
      server,
      cookies: await readCookies(),
      accessToken: readAccessToken(),
    })(uri)
    return { ok: true, source: { uri, headers } }
  }

  const sourceFor = async (request: SourceRequest): Promise<SourceOutcome> => {
    const [origin, read] = await Promise.all([pickOf(), ticketFor(request.media.id)])
    switch (read.kind) {
      case TICKET_READS.refused:
        return read.refusal
      case TICKET_READS.off:
        return cookieSource(request)
      case TICKET_READS.issued: {
        if (origin === null) return cookieSource(request)
        const uri = uriFor({ request, access: { origin, ticket: read.ticket } })
        checkAppCall({ method: APP_CALL_METHODS.get, url: uri })
        return { ok: true, source: { uri, headers: {} } }
      }
      default: {
        const unreachable: never = read
        return unreachable
      }
    }
  }

  return {
    // A jar that cannot be read, or an address the allowlist refuses, is an outcome like any
    // other refusal, so the player always hears back.
    source: (request) =>
      sourceFor(request).catch(() =>
        accessRefusal({ reason: ACCESS_REFUSALS.unreachable, server }),
      ),
    close: stopWatching,
  }
}
