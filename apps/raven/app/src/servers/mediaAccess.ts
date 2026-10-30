import {
  ACCESS_REFUSALS,
  APP_CALL_METHODS,
  AUTH_REFUSALS,
  type AuthRefusal,
  type AccessRefusal,
  type AccessRefusalReason,
  ApiError,
  type ApiClient,
  LOCKED_STATUS,
  MEDIA_ORIGIN_KINDS,
  MEDIA_PROBE_BYTES,
  MEDIA_PROBE_TIMEOUT_MS,
  MEDIA_TICKET_PARAM,
  type MaxHeight,
  type MediaAccess,
  type TicketedOrigin,
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
  toQueryString,
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
  /** A transcode's picture subtitle to burn into the picture, by track id; null for none. */
  burn: string | null
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
  /**
   * Where a video's subtitles are fetched from and the ticket they carry, as its picture is: a
   * media route takes a ticket, never the account's Bearer. Null where the server hands out no
   * ticket, or refuses one.
   */
  subtitleAccess: (mediaId: number) => Promise<TicketedOrigin | null>
  /** Stops watching the network. */
  close: () => void
}

/** What a player says when the server refuses the account its media is played under. */
export const ACCOUNT_ACCESS_MESSAGES = {
  signInAgain: (name: string): string => `Sign in to ${name} again.`,
  removed: (name: string): string => `Your access to ${name} was removed.`,
} as const

type AccountAccessMessageOfProps = { reason: AuthRefusal['reason']; name: string }

/**
 * The words for media the server refused the account on `name` for; null for `unavailable`,
 * accounts being down, which is an outage rather than a refusal of this one. An account sent back
 * to waiting has lost the access it had, as a revoked one has.
 */
const accountAccessMessageOf = ({ reason, name }: AccountAccessMessageOfProps): string | null => {
  switch (reason) {
    case AUTH_REFUSALS.signedOut:
      return ACCOUNT_ACCESS_MESSAGES.signInAgain(name)
    case AUTH_REFUSALS.pending:
    case AUTH_REFUSALS.revoked:
    case AUTH_REFUSALS.notOwner:
      return ACCOUNT_ACCESS_MESSAGES.removed(name)
    case AUTH_REFUSALS.unavailable:
      return null
    default: {
      const unreachable: never = reason
      return unreachable
    }
  }
}

export const MEDIA_ACCESS_MESSAGES = {
  locked: (name: string): string => `This video's library on ${name} is locked.`,
  gone: (name: string): string => `${name} no longer has this video.`,
  unreachable: (name: string): string => `${name} can't be reached.`,
  unreadable: (name: string): string => `${name} sent something raven can't read.`,
  account: ACCOUNT_ACCESS_MESSAGES.signInAgain,
} as const satisfies Record<AccessRefusalReason, (name: string) => string>

const UNAUTHORIZED_STATUS = 401
const FORBIDDEN_STATUS = 403
const NOT_FOUND_STATUS = 404
const SERVER_ERROR_STATUS = 500

const TICKET_READS = { issued: 'issued', off: 'off', refused: 'refused' } as const

type HeldTicket = { ticket: string; renewAt: number }

type TicketRead =
  | ({ kind: typeof TICKET_READS.issued } & HeldTicket)
  | { kind: typeof TICKET_READS.off }
  | { kind: typeof TICKET_READS.refused; refusal: AccessRefusal }

/** The ways one video is reached: `accessOf`'s answer, shared by its picture and its subtitles. */
const ACCESS_WAYS = {
  origin: 'origin',
  ownAddress: 'ownAddress',
  cookies: 'cookies',
  refused: 'refused',
} as const

type Access =
  | ({ kind: typeof ACCESS_WAYS.origin } & MediaAccess)
  | { kind: typeof ACCESS_WAYS.ownAddress; ticket: string }
  | { kind: typeof ACCESS_WAYS.cookies }
  | { kind: typeof ACCESS_WAYS.refused; refusal: AccessRefusal }

type AccessRefusalProps = {
  reason: AccessRefusalReason
  server: AppServer
}

const accessRefusal = ({ reason, server }: AccessRefusalProps): AccessRefusal => ({
  ok: false,
  reason,
  message: MEDIA_ACCESS_MESSAGES[reason](server.name),
})

type AccountRefusalOfProps = { error: ApiError; server: AppServer }

/**
 * A `401` or `403` to a ticket is the account's refusal, in raven player's words; the server's
 * fetch has already refreshed the token once for the first. Accounts being down is an outage.
 */
const accountRefusalOf = ({ error, server }: AccountRefusalOfProps): TicketRead => {
  const reason =
    error.refusal?.reason ??
    (error.status === UNAUTHORIZED_STATUS ? AUTH_REFUSALS.signedOut : AUTH_REFUSALS.revoked)
  const message = accountAccessMessageOf({ reason, name: server.name })
  return {
    kind: TICKET_READS.refused,
    refusal:
      message === null
        ? accessRefusal({ reason: ACCESS_REFUSALS.unreachable, server })
        : { ok: false, reason: ACCESS_REFUSALS.account, message },
  }
}

type RefusalOfProps = { error: unknown; server: AppServer }

const refusalOf = ({ error, server }: RefusalOfProps): TicketRead => {
  const refused = (reason: AccessRefusalReason): TicketRead => ({
    kind: TICKET_READS.refused,
    refusal: accessRefusal({ reason, server }),
  })
  // Anything but the server's own answer, a failed network above all, is an outage.
  if (!(error instanceof ApiError)) return refused(ACCESS_REFUSALS.unreachable)
  if (error.status === TICKETS_OFF_STATUS) return { kind: TICKET_READS.off }
  if (error.status === UNAUTHORIZED_STATUS || error.status === FORBIDDEN_STATUS) {
    return accountRefusalOf({ error, server })
  }
  if (error.status === LOCKED_STATUS) return refused(ACCESS_REFUSALS.locked)
  if (error.status === NOT_FOUND_STATUS) return refused(ACCESS_REFUSALS.gone)
  // A proxy in front of a restarting server answers 502 or 504.
  if (error.status >= SERVER_ERROR_STATUS) return refused(ACCESS_REFUSALS.unreachable)
  return refused(ACCESS_REFUSALS.unreadable)
}

type TicketedSourceProps = { uri: string }

/** A source that carries its ticket in its address: no header, and only a call the app may make. */
const ticketedSource = ({ uri }: TicketedSourceProps): SourceOutcome => {
  checkAppCall({ method: APP_CALL_METHODS.get, url: uri })
  return { ok: true, source: { uri, headers: {} } }
}

type WithTicketProps = { uri: string; ticket: string }

/** `uri` carrying `ticket`, as core's media URLs carry one: the last of its query. */
const withTicket = ({ uri, ticket }: WithTicketProps): string =>
  `${uri}${uri.includes('?') ? '&' : '?'}${toQueryString({ [MEDIA_TICKET_PARAM]: ticket })}`

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
 * ticket is read per video and renewed `TICKET_RENEW_MS` after it was read, inside an account ticket's five minutes,, by `now`. A
 * server that lists no origin, has none answering, or hands out no ticket (the 503 of one
 * without `RAVEN_MEDIA_SECRET`) plays from its own address with its cookies as headers, which
 * `cookieHeadersFor` gives only to its own API. A transcode from the `public` origin, away
 * from home, asks for the size `awayMaxHeight` reads at the moment, Settings' cap. A signed-in
 * account (`readAccessToken`) that has no origin to play from plays from the server's own
 * address by its ticket, never by its Bearer, and a ticket the server refuses it (`401`, `403`)
 * is the account's refusal in core's words. Nothing here logs: a ticket is only ever in the
 * source's address.
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

  const uriFor = ({ request: { media, mode, audio, burn }, access }: UriForProps): string => {
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
          burn,
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

  /**
   * How one video is reached, decided once for its picture and its subtitles alike: from the
   * origin picked, by ticket; with none to play from, a signed-in account from the server's own
   * address by its ticket, never by its Bearer (the native player sends that header as it was, and
   * the token ends within the hour while a film runs longer); a server that hands out no ticket,
   * or has no account signed in there, by its cookie; or refused.
   */
  const accessOf = async (mediaId: number): Promise<Access> => {
    const [origin, read] = await Promise.all([pickOf(), ticketFor(mediaId)])
    switch (read.kind) {
      case TICKET_READS.refused:
        return { kind: ACCESS_WAYS.refused, refusal: read.refusal }
      case TICKET_READS.off:
        return { kind: ACCESS_WAYS.cookies }
      case TICKET_READS.issued: {
        if (origin !== null) return { kind: ACCESS_WAYS.origin, origin, ticket: read.ticket }
        return readAccessToken() === null
          ? { kind: ACCESS_WAYS.cookies }
          : { kind: ACCESS_WAYS.ownAddress, ticket: read.ticket }
      }
      default: {
        const unreachable: never = read
        return unreachable
      }
    }
  }

  const sourceFor = async (request: SourceRequest): Promise<SourceOutcome> => {
    const access = await accessOf(request.media.id)
    switch (access.kind) {
      case ACCESS_WAYS.refused:
        return access.refusal
      case ACCESS_WAYS.cookies:
        return cookieSource(request)
      case ACCESS_WAYS.ownAddress:
        return ticketedSource({
          uri: withTicket({ uri: uriFor({ request, access: null }), ticket: access.ticket }),
        })
      case ACCESS_WAYS.origin:
        return ticketedSource({
          uri: uriFor({ request, access: { origin: access.origin, ticket: access.ticket } }),
        })
      default: {
        const unreachable: never = access
        return unreachable
      }
    }
  }

  /** Where a video's subtitles are fetched from by ticket, as its picture is; null on the cookie. */
  const subtitleAccess = async (mediaId: number): Promise<TicketedOrigin | null> => {
    const access = await accessOf(mediaId)
    switch (access.kind) {
      case ACCESS_WAYS.origin:
        return { origin: access.origin, ticket: access.ticket }
      case ACCESS_WAYS.ownAddress:
        return { origin: { url: server.origin }, ticket: access.ticket }
      case ACCESS_WAYS.cookies:
      case ACCESS_WAYS.refused:
        return null
      default: {
        const unreachable: never = access
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
    subtitleAccess: (mediaId) => subtitleAccess(mediaId).catch(() => null),
    close: stopWatching,
  }
}
