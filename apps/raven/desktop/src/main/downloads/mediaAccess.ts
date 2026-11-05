import {
  AUTH_REFUSALS,
  isMediaId,
  isSidecarTrackId,
  MEDIA_PURPOSE_PARAM,
  MEDIA_TICKET_PARAM,
  STREAM_PURPOSES,
  toQueryString,
} from '@raven/core'
import { SIGNAL_EVENTS } from '@/main/bounded'
import { SERVER_GONE, type ServerEntry } from '@/main/desktopConfig'
import { accountRefusedMessage, DOWNLOAD_MESSAGES } from '@/main/downloads/downloadMessages'
import { EXPAND_MESSAGES } from '@/main/downloads/expand'
import {
  type AccountTickets,
  TICKET_OUTCOMES,
  type TicketOutcome,
} from '@/main/servers/accountTickets'
import { API_PATHS, MEDIA_FILE_PATH, subtitlePathOf } from '@/main/servers/allowlist'
import type { OriginPicks } from '@/main/servers/originPicks'
import { CALL_MESSAGES } from '@/main/servers/serverCalls'
import { TIMER_MAX_MS, type Timers } from '@/main/stateStore'

/**
 * The most account tickets a server's downloads mint in any `windowMs`, a ticket's life on the
 * server. The server keeps 32 live per account, so a fast queue of short files leaves the rest to
 * playback, on every device, rather than spending them all.
 */
export const DOWNLOAD_MINTS = { budget: 16, windowMs: 300_000 } as const

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
  serverOf: (serverId: string) => ServerEntry | null
  picks: OriginPicks
  now: () => number
  timers: Timers
  tickets: Pick<AccountTickets, 'ticketFor'>
}

/**
 * Each run reaches the server with an account ticket minted for it, on the media origin `picks`
 * holds for the server (shared with the relay); `now` is the wall clock the mint budget is kept by.
 */
export const createMediaAccess = ({
  serverOf,
  picks,
  now,
  timers,
  tickets,
}: CreateMediaAccessProps): MediaAccess => {
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
    const [url, outcome] = await Promise.all([
      picks.originOf(server),
      tickets.ticketFor({ serverId: server.id, mediaId, isFresh: true }),
    ])
    if (outcome.kind !== TICKET_OUTCOMES.ticket) return mintRefusalOf({ outcome, server })
    return { ok: true, access: { url, ticket: outcome.ticket } }
  }

  return {
    accessFor: async ({ serverId, mediaId, signal }) => {
      const server = serverOf(serverId)
      if (server === null)
        return { ok: false, reason: ACCESS_REFUSALS.unreachable, message: SERVER_GONE }
      return accountAccess({ server, mediaId, signal })
    },
    forget: picks.forget,
  }
}
