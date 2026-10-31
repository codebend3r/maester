import {
  type AudioBitrate,
  AUTH_REFUSALS,
  type AuthRefusal,
  isMediaId,
  isMediaTracks,
  isOpaqueId,
  LOCKED_STATUS,
  PLAYER_ERROR_REASONS,
  PLAYER_SOURCE_KINDS,
  type PlayerErrorReason,
  type PlayerSource,
  type SubtitleTrack,
  TITLE_REFUSALS,
  type TitleRefusal,
} from '@raven/core'
import { BOUNDED_OUTCOMES, within } from '@/main/bounded'
import { SERVER_GONE, type ServerEntry } from '@/main/desktopConfig'
import { parseJson } from '@/main/parseJson'
import {
  type AccountRefusalReader,
  type FailureExplainer,
  type ResolvedServerSource,
  type ServerTarget,
} from '@/main/player/loadTarget'
import { PLAYER_PHASES } from '@/main/player/phases'
import { PLAYER_MESSAGES } from '@/main/player/playerMessages'
import {
  type AccountTickets,
  TICKET_OUTCOMES,
  type TicketOutcome,
} from '@/main/servers/accountTickets'
import { CALL_NAMES } from '@/main/servers/allowlist'
import { ACCOUNT_REFUSAL_STATUSES, refusalAt } from '@/main/servers/authRefusals'
import type { MediaRelay } from '@/main/servers/mediaRelay'
import { loggable, type ServerCallResult, type ServerCalls } from '@/main/servers/serverCalls'
import { sidecarTracksOf } from '@/main/servers/sidecarTracks'
import { HTTP_STATUSES } from '@/shared/httpStatuses'
import { messageOf } from '@/shared/messageOf'

export const SOURCE_MESSAGES = {
  unknownServer: SERVER_GONE,
  badTitle: 'Raven cannot open that title.',
  lost: (name: string) =>
    `Raven lost its connection to ${name}. Where you stopped last is saved there.`,
  relocked: (name: string) => `${name} locked this library again.`,
  gone: (name: string) => `This title is not on ${name} any more.`,
  cannotOpen: (name: string) => `Raven could not open this title from ${name}.`,
  signIn: (name: string) => `Sign in to ${name} to play this.`,
  signInAgain: (name: string) => `Sign in to ${name} again.`,
  pending: (name: string) => `Your account on ${name} is waiting for approval.`,
  removed: (name: string) => `Your access to ${name} was removed.`,
} as const

export const EXPLAIN_TIMEOUT_MS = 5000
/**
 * The page's commands wait in line behind a load, so a slow track list must not hold the
 * title (or a Back after it) for long: past this the title plays without sidecars.
 */
export const TRACKS_TIMEOUT_MS = 3000

type Sidecars = ServerTarget['sidecars']
type Failure = { reason: PlayerErrorReason; message: string }

type ServerSource = Extract<PlayerSource, { kind: typeof PLAYER_SOURCE_KINDS.server }>

type AccountFailureOfProps = {
  reason: AuthRefusal['reason']
  name: string
}

/** What the player says when the server refused the account mid-play; null when it is no account matter. */
const accountFailureOf = ({ reason, name }: AccountFailureOfProps): Failure | null => {
  switch (reason) {
    case AUTH_REFUSALS.signedOut:
      return { reason: PLAYER_ERROR_REASONS.account, message: SOURCE_MESSAGES.signInAgain(name) }
    // An account sent back to waiting while it played has lost the access it had.
    case AUTH_REFUSALS.pending:
    case AUTH_REFUSALS.revoked:
    case AUTH_REFUSALS.notOwner:
      return { reason: PLAYER_ERROR_REASONS.account, message: SOURCE_MESSAGES.removed(name) }
    case AUTH_REFUSALS.unavailable:
      return null
    default: {
      const unreachable: never = reason
      return unreachable
    }
  }
}

type StartRefusalOfProps = {
  outcome: Exclude<TicketOutcome, { kind: typeof TICKET_OUTCOMES.ticket }>
  name: string
}

/**
 * Why a title cannot start, when its first ticket could not be minted: the reason the page acts on
 * (sign in, the PIN, or only the words) and the words.
 */
export const startRefusalOf = ({
  outcome,
  name,
}: StartRefusalOfProps): { reason: TitleRefusal; message: string } => {
  switch (outcome.kind) {
    case TICKET_OUTCOMES.refused:
      switch (outcome.reason) {
        case AUTH_REFUSALS.signedOut:
          return { reason: TITLE_REFUSALS.signedOut, message: SOURCE_MESSAGES.signIn(name) }
        case AUTH_REFUSALS.pending:
          return { reason: TITLE_REFUSALS.denied, message: SOURCE_MESSAGES.pending(name) }
        case AUTH_REFUSALS.revoked:
        case AUTH_REFUSALS.notOwner:
          return { reason: TITLE_REFUSALS.denied, message: SOURCE_MESSAGES.removed(name) }
        case AUTH_REFUSALS.unavailable:
          return { reason: TITLE_REFUSALS.unreachable, message: SOURCE_MESSAGES.lost(name) }
        default: {
          const unreachable: never = outcome.reason
          return unreachable
        }
      }
    case TICKET_OUTCOMES.locked:
      return { reason: TITLE_REFUSALS.locked, message: SOURCE_MESSAGES.relocked(name) }
    case TICKET_OUTCOMES.gone:
      return { reason: TITLE_REFUSALS.gone, message: SOURCE_MESSAGES.gone(name) }
    case TICKET_OUTCOMES.unreachable:
      return { reason: TITLE_REFUSALS.unreachable, message: SOURCE_MESSAGES.lost(name) }
    default: {
      const unreachable: never = outcome
      return unreachable
    }
  }
}

/** The account refusal a `401` or `403` from the server carries, or null for any other answer. */
const accountRefusalIn = (result: ServerCallResult): AuthRefusal['reason'] | null =>
  result.ok ? refusalAt({ ...result, statuses: ACCOUNT_REFUSAL_STATUSES }) : null

type CreateServerSourcesProps = {
  serverOf: (serverId: string) => ServerEntry | null
  calls: Pick<ServerCalls, 'call'>
  tickets: Pick<AccountTickets, 'ticketFor'>
  relay: Pick<MediaRelay, 'open' | 'refusalOf' | 'close'>
  warn: (message: string) => void
}

/** A track for the music engine: its file, or its AAC transcode at `kbps`. */
type TrackSource = Omit<ServerSource, 'kind'> & { kbps: AudioBitrate | null }

/**
 * Server titles for the player, which mpv plays through the loopback relay: main builds every
 * URL from the stored origin and a video's sidecars from the server's own track list, and no cookie,
 * token or ticket is in anything mpv holds. Main asks the relay, then the server, why when mpv
 * fails to open or stops one of its titles.
 */
export const createServerSources = ({
  serverOf,
  calls,
  tickets,
  relay,
  warn,
}: CreateServerSourcesProps): {
  /** A video, with the server's subtitle sidecars. */
  resolve: (source: ServerSource) => Promise<ResolvedServerSource>
  /** A track, which has no sidecars. */
  resolveTrack: (source: TrackSource) => Promise<ResolvedServerSource>
  explain: FailureExplainer
  refusedAccount: AccountRefusalReader
} => {
  type TrackListOfProps = {
    server: ServerEntry
    mediaId: number
  }

  const trackListOf = async ({
    server,
    mediaId,
  }: TrackListOfProps): Promise<readonly SubtitleTrack[]> => {
    const name = loggable(server.name)
    try {
      const bounded = await within({
        task: calls.call({ serverId: server.id, call: { name: CALL_NAMES.getTracks, mediaId } }),
        ms: TRACKS_TIMEOUT_MS,
      })
      if (bounded.outcome === BOUNDED_OUTCOMES.late) {
        warn(`no sidecars from ${name}: its tracks did not answer in time`)
        return []
      }
      if (bounded.outcome === BOUNDED_OUTCOMES.failed) {
        warn(`no sidecars from ${name}: its tracks failed: ${loggable(messageOf(bounded.error))}`)
        return []
      }
      const { result } = bounded
      if (!result.ok) {
        warn(`no sidecars from ${name}: ${loggable(result.message)}`)
        return []
      }
      if (result.status !== HTTP_STATUSES.ok) {
        warn(`no sidecars from ${name}: its tracks answered ${result.status}`)
        return []
      }
      const parsed = parseJson(result.body)
      if (!isMediaTracks(parsed)) {
        warn(`no sidecars from ${name}: its tracks were not a track list`)
        return []
      }
      return sidecarTracksOf(parsed)
    } catch (error) {
      warn(`no sidecars from ${name}: ${loggable(messageOf(error))}`)
      return []
    }
  }

  type ResolveRelayedProps = {
    server: ServerEntry
    mediaId: number
    trackList: Promise<readonly SubtitleTrack[]>
    kbps: AudioBitrate | null
  }

  const resolveRelayed = async ({
    server,
    mediaId,
    trackList,
    kbps,
  }: ResolveRelayedProps): Promise<ResolvedServerSource> => {
    // The first ticket before anything opens: a title the account may not play is refused here.
    const [tracks, first] = await Promise.all([
      trackList,
      tickets.ticketFor({ serverId: server.id, mediaId, isFresh: false }),
    ])
    if (first.kind !== TICKET_OUTCOMES.ticket) {
      return { ok: false, message: startRefusalOf({ outcome: first, name: server.name }).message }
    }
    const opened = await relay
      .open({ server, mediaId, sidecarTrackIds: tracks.map((track) => track.id), kbps })
      .catch(() => null)
    if (opened === null) {
      warn(`Raven could not relay a title from ${loggable(server.name)}`)
      return { ok: false, message: SOURCE_MESSAGES.cannotOpen(server.name) }
    }
    const sidecars: Sidecars = tracks.flatMap((track, index) => {
      const url = opened.sidecarUrls[index]
      return url === undefined
        ? []
        : [{ url, title: track.title ?? '', language: track.language ?? '' }]
    })
    return {
      ok: true,
      target: {
        kind: PLAYER_SOURCE_KINDS.server,
        serverId: server.id,
        mediaId,
        url: opened.fileUrl,
        sidecars,
        relay: { loadId: opened.loadId, base: opened.base },
      },
    }
  }

  type ServerOfSourceProps = { serverId: string; mediaId: number }

  /** The server a title is on, or why it cannot be opened. */
  const serverOfSource = ({
    serverId,
    mediaId,
  }: ServerOfSourceProps): { ok: true; server: ServerEntry } | { ok: false; message: string } => {
    if (!isOpaqueId(serverId) || !isMediaId(mediaId)) {
      return { ok: false, message: SOURCE_MESSAGES.badTitle }
    }
    const server = serverOf(serverId)
    if (server === null) return { ok: false, message: SOURCE_MESSAGES.unknownServer }
    return { ok: true, server }
  }

  type ResolveProps = ServerSource

  const resolve = async ({ serverId, mediaId }: ResolveProps): Promise<ResolvedServerSource> => {
    const found = serverOfSource({ serverId, mediaId })
    if (!found.ok) return found
    // Read while the first ticket is minted: a video wants its sidecars either way.
    const trackList = trackListOf({ server: found.server, mediaId })
    return resolveRelayed({ server: found.server, mediaId, trackList, kbps: null })
  }

  const resolveTrack = async ({
    serverId,
    mediaId,
    kbps,
  }: TrackSource): Promise<ResolvedServerSource> => {
    const found = serverOfSource({ serverId, mediaId })
    if (!found.ok) return found
    return resolveRelayed({ server: found.server, mediaId, trackList: Promise.resolve([]), kbps })
  }

  /**
   * What the player says for a relayed title whose account the relay saw refused, or null. The
   * relay has already told the account; the player's stall and its ending both ask this.
   */
  const refusedAccount: AccountRefusalReader = (target) => {
    const server = serverOf(target.serverId)
    const reason = relay.refusalOf(target.relay.loadId)
    if (server === null || reason === null) return null
    return accountFailureOf({ reason, name: server.name })
  }

  /** A failed title is over, so its relay secret is retired. */
  const endRelayedLoad = (target: ServerTarget): void => {
    relay.close(target.relay.loadId)
  }

  const explain: FailureExplainer = async ({ target, phase }) => {
    const server = serverOf(target.serverId)
    if (server === null) {
      return { reason: PLAYER_ERROR_REASONS.network, message: SOURCE_MESSAGES.lost('the server') }
    }
    // mpv ends a refused stream as if it ran out, so the relay is the one that knows.
    const relayed = refusedAccount(target)
    endRelayedLoad(target)
    if (relayed !== null) return relayed
    const bounded = await within({
      task: calls.call({
        serverId: server.id,
        call: { name: CALL_NAMES.getMedia, mediaId: target.mediaId },
      }),
      ms: EXPLAIN_TIMEOUT_MS,
    })
    if (bounded.outcome !== BOUNDED_OUTCOMES.answered || !bounded.result.ok) {
      return { reason: PLAYER_ERROR_REASONS.network, message: SOURCE_MESSAGES.lost(server.name) }
    }
    const { result } = bounded
    const refused = accountRefusalIn(result)
    const fromServer =
      refused === null ? null : accountFailureOf({ reason: refused, name: server.name })
    if (fromServer !== null) return fromServer
    if (result.status === LOCKED_STATUS) {
      return { reason: PLAYER_ERROR_REASONS.locked, message: SOURCE_MESSAGES.relocked(server.name) }
    }
    if (result.status === HTTP_STATUSES.notFound) {
      return { reason: PLAYER_ERROR_REASONS.open, message: SOURCE_MESSAGES.gone(server.name) }
    }
    return phase === PLAYER_PHASES.loading
      ? { reason: PLAYER_ERROR_REASONS.open, message: SOURCE_MESSAGES.cannotOpen(server.name) }
      : { reason: PLAYER_ERROR_REASONS.decode, message: PLAYER_MESSAGES.stopped }
  }

  return { resolve, resolveTrack, explain, refusedAccount }
}
