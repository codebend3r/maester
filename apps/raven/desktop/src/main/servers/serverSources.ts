import {
  type AudioBitrate,
  AUTH_REFUSALS,
  type Guard,
  isMediaId,
  isMediaItem,
  isMediaTracks,
  isOpaqueId,
  LOCKED_STATUS,
  PLAYER_ERROR_REASONS,
  PLAYER_SOURCE_KINDS,
  type PlayerErrorReason,
  type PlayerSource,
  remoteLimitApplies,
  remoteTranscodeFor,
  type SubtitleTrack,
  TITLE_REFUSALS,
  type TitleRefusal,
} from '@raven/core'
import { BOUNDED_OUTCOMES, within } from '@/main/bounded'
import { SERVER_NAME, type ServerEntry } from '@/main/desktopConfig'
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
import { accountRefusalOf, type AccountRefusal } from '@/main/servers/authRefusals'
import { type MediaRelay, RELAYED_MEDIA_KINDS, type RelayedMedia } from '@/main/servers/mediaRelay'
import type { MediaPlace, OriginPicks } from '@/main/servers/originPicks'
import { loggable, type ServerCallResult, type ServerCalls } from '@/main/servers/serverCalls'
import { sidecarTracksOf } from '@/main/servers/sidecarTracks'
import { messageOf } from '@/shared/messageOf'
import { HTTP_STATUSES } from '@shared/http'

export const SOURCE_MESSAGES = {
  badTitle: 'Raven cannot open that title.',
  otherServer: 'Raven plays titles from its own server only.',
  lost: `Raven lost its connection to ${SERVER_NAME}. Where you stopped last is saved there.`,
  relocked: `${SERVER_NAME} locked this library again.`,
  gone: `This title is not on ${SERVER_NAME} any more.`,
  cannotOpen: `Raven could not open this title from ${SERVER_NAME}.`,
  signIn: `Sign in to ${SERVER_NAME} to play this.`,
  signInAgain: `Sign in to ${SERVER_NAME} again.`,
  pending: `Your account on ${SERVER_NAME} is waiting for approval.`,
  removed: `Your access to ${SERVER_NAME} was removed.`,
} as const

export const EXPLAIN_TIMEOUT_MS = 5000
/**
 * The page's commands wait in line behind a load, so a slow track list must not hold the
 * title (or a Back after it) for long: past this the title plays without sidecars.
 */
export const TRACKS_TIMEOUT_MS = 3000
/**
 * How long a title away from home waits on its media's bitrate before it plays its file as it
 * would at home: the load waits on it, as on the tracks.
 */
export const MEDIA_TIMEOUT_MS = 3000

const THE_FILE: RelayedMedia = { kind: RELAYED_MEDIA_KINDS.file }

type Sidecars = ServerTarget['sidecars']
type Failure = { reason: PlayerErrorReason; message: string }

type ServerSource = Extract<PlayerSource, { kind: typeof PLAYER_SOURCE_KINDS.server }>

/** What the player says when the server refused the account mid-play. */
const ACCOUNT_FAILURES = {
  [AUTH_REFUSALS.signedOut]: {
    reason: PLAYER_ERROR_REASONS.account,
    message: SOURCE_MESSAGES.signInAgain,
  },
  // An account sent back to waiting while it played has lost the access it had.
  [AUTH_REFUSALS.pending]: {
    reason: PLAYER_ERROR_REASONS.account,
    message: SOURCE_MESSAGES.removed,
  },
  [AUTH_REFUSALS.revoked]: {
    reason: PLAYER_ERROR_REASONS.account,
    message: SOURCE_MESSAGES.removed,
  },
  [AUTH_REFUSALS.notOwner]: {
    reason: PLAYER_ERROR_REASONS.account,
    message: SOURCE_MESSAGES.removed,
  },
} as const satisfies Record<AccountRefusal, Failure>

type StartRefusal = { reason: TitleRefusal; message: string }

/** Why a title cannot start when its first ticket was refused for the account. */
const ACCOUNT_START_REFUSALS = {
  [AUTH_REFUSALS.signedOut]: { reason: TITLE_REFUSALS.signedOut, message: SOURCE_MESSAGES.signIn },
  [AUTH_REFUSALS.pending]: { reason: TITLE_REFUSALS.denied, message: SOURCE_MESSAGES.pending },
  [AUTH_REFUSALS.revoked]: { reason: TITLE_REFUSALS.denied, message: SOURCE_MESSAGES.removed },
  [AUTH_REFUSALS.notOwner]: { reason: TITLE_REFUSALS.denied, message: SOURCE_MESSAGES.removed },
} as const satisfies Record<AccountRefusal, StartRefusal>

/**
 * Why a title cannot start, when its first ticket could not be minted: the reason the page acts on
 * (sign in, the PIN, or only the words) and the words.
 */
type StartRefusalOfProps = Exclude<TicketOutcome, { kind: typeof TICKET_OUTCOMES.ticket }>

export const startRefusalOf = (outcome: StartRefusalOfProps): StartRefusal => {
  switch (outcome.kind) {
    case TICKET_OUTCOMES.refused:
      return ACCOUNT_START_REFUSALS[outcome.reason]
    case TICKET_OUTCOMES.locked:
      return { reason: TITLE_REFUSALS.locked, message: SOURCE_MESSAGES.relocked }
    case TICKET_OUTCOMES.gone:
      return { reason: TITLE_REFUSALS.gone, message: SOURCE_MESSAGES.gone }
    case TICKET_OUTCOMES.unreachable:
      return { reason: TITLE_REFUSALS.unreachable, message: SOURCE_MESSAGES.lost }
    default: {
      const unreachable: never = outcome
      return unreachable
    }
  }
}

/** The account refusal a `401` or `403` from the server carries, or null for any other answer. */
const accountRefusalIn = (result: ServerCallResult): AccountRefusal | null =>
  result.ok ? accountRefusalOf(result) : null

type CreateServerSourcesProps = {
  server: ServerEntry
  calls: Pick<ServerCalls, 'call'>
  tickets: Pick<AccountTickets, 'ticketFor'>
  relay: Pick<MediaRelay, 'open' | 'refusalOf' | 'close'>
  /** The media origin each title is relayed from, shared with the downloads. */
  picks: OriginPicks
  warn: (message: string) => void
}

/** A track for the music engine: its file, or its AAC transcode at `kbps`. */
type TrackSource = { mediaId: number; kbps: AudioBitrate | null }

type ServerCall = Parameters<ServerCalls['call']>[0]['call']

const JSON_READS = {
  read: 'read',
  late: 'late',
  failed: 'failed',
  refused: 'refused',
  status: 'status',
  misshapen: 'misshapen',
} as const

type JsonRead<T> =
  | { kind: typeof JSON_READS.read; value: T }
  | { kind: typeof JSON_READS.late }
  | { kind: typeof JSON_READS.failed; message: string }
  | { kind: typeof JSON_READS.refused; message: string }
  | { kind: typeof JSON_READS.status; status: number }
  | { kind: typeof JSON_READS.misshapen }

type JsonProblem<T> = Exclude<JsonRead<T>, { kind: typeof JSON_READS.read }>

/** Why a title's tracks gave no sidecars, as the log says it. */
const tracksProblemOf = <T>(problem: JsonProblem<T>): string => {
  switch (problem.kind) {
    case JSON_READS.late:
      return 'its tracks did not answer in time'
    case JSON_READS.failed:
      return `its tracks failed: ${loggable(problem.message)}`
    case JSON_READS.refused:
      return loggable(problem.message)
    case JSON_READS.status:
      return `its tracks answered ${problem.status}`
    case JSON_READS.misshapen:
      return 'its tracks were not a track list'
    default: {
      const unreachable: never = problem
      return unreachable
    }
  }
}

/**
 * Server titles for the player, which mpv plays through the loopback relay: main builds every
 * URL from the media origin `picks` holds (the stored origin when none answers) and a video's
 * sidecars from the server's own track list, and no cookie,
 * token or ticket is in anything mpv holds. Main asks the relay, then the server, why when mpv
 * fails to open or stops one of its titles.
 */
export type ServerSources = {
  /** A video, with the server's subtitle sidecars. */
  resolve: (source: ServerSource) => Promise<ResolvedServerSource>
  /** A track, which has no sidecars. */
  resolveTrack: (source: TrackSource) => Promise<ResolvedServerSource>
  explain: FailureExplainer
  refusedAccount: AccountRefusalReader
}

export const createServerSources = ({
  server,
  calls,
  tickets,
  relay,
  picks,
  warn,
}: CreateServerSourcesProps): ServerSources => {
  type ReadJsonProps<T> = {
    call: ServerCall
    ms: number
    guard: Guard<T>
  }

  /** One bounded call's JSON, narrowed by `guard`, or why there is none. */
  const readJson = async <T>({ call, ms, guard }: ReadJsonProps<T>): Promise<JsonRead<T>> => {
    const bounded = await within({ task: calls.call({ call }), ms })
    if (bounded.outcome === BOUNDED_OUTCOMES.late) return { kind: JSON_READS.late }
    if (bounded.outcome === BOUNDED_OUTCOMES.failed) {
      return { kind: JSON_READS.failed, message: messageOf(bounded.error) }
    }
    const { result } = bounded
    if (!result.ok) return { kind: JSON_READS.refused, message: result.message }
    if (result.status !== HTTP_STATUSES.ok)
      return { kind: JSON_READS.status, status: result.status }
    const parsed = parseJson(result.body)
    if (!guard(parsed)) return { kind: JSON_READS.misshapen }
    return { kind: JSON_READS.read, value: parsed }
  }

  const trackListOf = async (mediaId: number): Promise<readonly SubtitleTrack[]> => {
    try {
      const read = await readJson({
        call: { name: CALL_NAMES.getTracks, mediaId },
        ms: TRACKS_TIMEOUT_MS,
        guard: isMediaTracks,
      })
      if (read.kind === JSON_READS.read) return sidecarTracksOf(read.value)
      warn(`no sidecars from ${SERVER_NAME}: ${tracksProblemOf(read)}`)
      return []
    } catch (error) {
      warn(`no sidecars from ${SERVER_NAME}: ${loggable(messageOf(error))}`)
      return []
    }
  }

  /** The media's bitrate as the server knows it; null when it does not, or does not say in time. */
  const bitrateOf = async (mediaId: number): Promise<number | null> => {
    const read = await readJson({
      call: { name: CALL_NAMES.getMedia, mediaId },
      ms: MEDIA_TIMEOUT_MS,
      guard: isMediaItem,
    })
    if (read.kind === JSON_READS.read) return read.value.bitrate
    warn(`${SERVER_NAME} did not say a title's bitrate, so it plays its file`)
    return null
  }

  type VideoMediaOfProps = { mediaId: number; place: MediaPlace }

  /**
   * What a video plays: its file, or away from home, when the file is over the remote limit, the
   * server's transcode at that limit (core's `remoteTranscodeFor`, whose size the master's URL
   * must name). The bitrate is asked for only when the limit applies (core's
   * `remoteLimitApplies`), so a play at home makes no call more.
   */
  const videoMediaOf = async ({ mediaId, place }: VideoMediaOfProps): Promise<RelayedMedia> => {
    if (!remoteLimitApplies(place)) return THE_FILE
    const bitrate = await bitrateOf(mediaId)
    const quality = remoteTranscodeFor({
      media: { bitrate },
      origin: place.origin,
      remote: place.remote,
    })
    return quality === null ? THE_FILE : { kind: RELAYED_MEDIA_KINDS.transcode, quality }
  }

  type ResolveRelayedProps = {
    mediaId: number
    trackList: Promise<readonly SubtitleTrack[]>
    /** What the load relays, given where it is played from. */
    mediaFor: (place: MediaPlace) => Promise<RelayedMedia>
  }

  const resolveRelayed = async ({
    mediaId,
    trackList,
    mediaFor,
  }: ResolveRelayedProps): Promise<ResolvedServerSource> => {
    /*
     * The first ticket before anything opens: a title the account may not play is refused here.
     * The origin is picked meanwhile; a ticket opens the file on any of the server's origins.
     */
    const [tracks, first, placed] = await Promise.all([
      trackList,
      tickets.ticketFor({ mediaId, isFresh: false }),
      picks.placeOf().then(async (place) => ({ place, media: await mediaFor(place) })),
    ])
    if (first.kind !== TICKET_OUTCOMES.ticket) {
      return { ok: false, message: startRefusalOf(first).message }
    }
    const opened = await relay
      .open({
        origin: placed.place.url,
        mediaId,
        sidecarTrackIds: tracks.map((track) => track.id),
        media: placed.media,
      })
      .catch(() => null)
    if (opened === null) {
      warn(`Raven could not relay a title from ${SERVER_NAME}`)
      return { ok: false, message: SOURCE_MESSAGES.cannotOpen }
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
        mediaId,
        url: opened.fileUrl,
        sidecars,
        relay: { loadId: opened.loadId, base: opened.base },
      },
    }
  }

  const resolve: ServerSources['resolve'] = async ({ serverId, mediaId }) => {
    if (!isOpaqueId(serverId) || !isMediaId(mediaId)) {
      return { ok: false, message: SOURCE_MESSAGES.badTitle }
    }
    // A title of a server an older Raven kept besides is reached no more.
    if (serverId !== server.id) return { ok: false, message: SOURCE_MESSAGES.otherServer }
    // Read while the first ticket is minted: a video wants its sidecars either way.
    return resolveRelayed({
      mediaId,
      trackList: trackListOf(mediaId),
      mediaFor: (place) => videoMediaOf({ mediaId, place }),
    })
  }

  const resolveTrack: ServerSources['resolveTrack'] = async ({ mediaId, kbps }) => {
    if (!isMediaId(mediaId)) return { ok: false, message: SOURCE_MESSAGES.badTitle }
    const media: RelayedMedia = kbps === null ? THE_FILE : { kind: RELAYED_MEDIA_KINDS.audio, kbps }
    return resolveRelayed({ mediaId, trackList: Promise.resolve([]), mediaFor: async () => media })
  }

  /**
   * What the player says for a relayed title whose account the relay saw refused, or null. The
   * relay has already told the account; the player's stall and its ending both ask this.
   */
  const refusedAccount: AccountRefusalReader = (target) => {
    const reason = relay.refusalOf(target.relay.loadId)
    return reason === null ? null : ACCOUNT_FAILURES[reason]
  }

  /** A failed title is over, so its relay secret is retired. */
  const endRelayedLoad = (target: ServerTarget): void => {
    relay.close(target.relay.loadId)
  }

  const explain: FailureExplainer = async ({ target, phase }) => {
    // mpv ends a refused stream as if it ran out, so the relay is the one that knows.
    const relayed = refusedAccount(target)
    endRelayedLoad(target)
    if (relayed !== null) return relayed
    // The origin picked may be why the title stopped; the next title probes again.
    picks.forget()
    const bounded = await within({
      task: calls.call({ call: { name: CALL_NAMES.getMedia, mediaId: target.mediaId } }),
      ms: EXPLAIN_TIMEOUT_MS,
    })
    if (bounded.outcome !== BOUNDED_OUTCOMES.answered || !bounded.result.ok) {
      return { reason: PLAYER_ERROR_REASONS.network, message: SOURCE_MESSAGES.lost }
    }
    const { result } = bounded
    const refused = accountRefusalIn(result)
    if (refused !== null) return ACCOUNT_FAILURES[refused]
    if (result.status === LOCKED_STATUS) {
      return { reason: PLAYER_ERROR_REASONS.locked, message: SOURCE_MESSAGES.relocked }
    }
    if (result.status === HTTP_STATUSES.notFound) {
      return { reason: PLAYER_ERROR_REASONS.open, message: SOURCE_MESSAGES.gone }
    }
    return phase === PLAYER_PHASES.loading
      ? { reason: PLAYER_ERROR_REASONS.open, message: SOURCE_MESSAGES.cannotOpen }
      : { reason: PLAYER_ERROR_REASONS.decode, message: PLAYER_MESSAGES.stopped }
  }

  return { resolve, resolveTrack, explain, refusedAccount }
}
