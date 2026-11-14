import {
  isMediaId,
  isSidecarTrackId,
  MEDIA_PURPOSE_PARAM,
  MEDIA_TICKET_PARAM,
  STREAM_PURPOSES,
  toQueryString,
} from '@raven/core'
import { SIGNAL_EVENTS } from '@/main/bounded'
import type { AccountRefusal } from '@/main/servers/authRefusals'
import {
  type AccountTickets,
  TICKET_OUTCOMES,
  type TicketOutcome,
} from '@/main/servers/accountTickets'
import { API_PATHS, MEDIA_FILE_PATH, subtitlePathOf } from '@/main/servers/allowlist'
import type { OriginPicks } from '@/main/servers/originPicks'
import { TIMER_MAX_MS, type Timers } from '@/main/timers'

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
  | {
      ok: false
      reason: Exclude<
        (typeof ACCESS_REFUSALS)[keyof typeof ACCESS_REFUSALS],
        typeof ACCESS_REFUSALS.account
      >
    }
  | { ok: false; reason: typeof ACCESS_REFUSALS.account; refusal: AccountRefusal }

type AccessForProps = {
  mediaId: number
  signal: AbortSignal
}

export type MediaAccess = {
  /** `signal` is the run's: a run stopped while it waits on the mint budget mints nothing. */
  accessFor: (input: AccessForProps) => Promise<AccessOutcome>
  forget: () => void
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

const UNREACHABLE: AccessOutcome = { ok: false, reason: ACCESS_REFUSALS.unreachable }

type Refusal = Exclude<TicketOutcome, { kind: typeof TICKET_OUTCOMES.ticket }>

/** What a mint that gave no ticket comes to, in the refusals the queue already knows. */
const mintRefusalOf = (outcome: Refusal): AccessOutcome => {
  switch (outcome.kind) {
    case TICKET_OUTCOMES.refused:
      return { ok: false, reason: ACCESS_REFUSALS.account, refusal: outcome.reason }
    case TICKET_OUTCOMES.locked:
      return { ok: false, reason: ACCESS_REFUSALS.locked }
    case TICKET_OUTCOMES.gone:
      return { ok: false, reason: ACCESS_REFUSALS.gone }
    case TICKET_OUTCOMES.unreachable:
      return UNREACHABLE
    default: {
      const unreachable: never = outcome
      return unreachable
    }
  }
}

type CreateMediaAccessProps = {
  picks: OriginPicks
  now: () => number
  timers: Timers
  tickets: Pick<AccountTickets, 'ticketFor'>
}

/**
 * Each run reaches the server with an account ticket minted for it, on the media origin `picks`
 * holds (shared with the relay); `now` is the wall clock the mint budget is kept by.
 */
export const createMediaAccess = ({
  picks,
  now,
  timers,
  tickets,
}: CreateMediaAccessProps): MediaAccess => {
  /** When the downloads minted, by Raven's clock, inside the last window. */
  let minted: readonly number[] = []

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

  /**
   * Takes one of the mints, waiting while the window's are spent until the oldest ages out.
   * False when the run stopped first, and nothing was taken.
   */
  const takeMint = async (signal: AbortSignal): Promise<boolean> => {
    if (signal.aborted) return false
    const time = now()
    const recent = minted.filter((at) => at > time - DOWNLOAD_MINTS.windowMs && at <= time)
    if (recent.length < DOWNLOAD_MINTS.budget) {
      minted = [...recent, time]
      return true
    }
    // A clock set back never waits longer than one window.
    const ms = Math.min(
      Math.max(Math.min(...recent) + DOWNLOAD_MINTS.windowMs - time, 1),
      DOWNLOAD_MINTS.windowMs,
    )
    return (await waitFor({ ms, signal })) && takeMint(signal)
  }

  return {
    /** The picked origin, or the server's own when none answers, with a ticket minted fresh. */
    accessFor: async ({ mediaId, signal }) => {
      // The queue has already let go of a stopped run, so what this answers is never read.
      if (!(await takeMint(signal))) return UNREACHABLE
      const [url, outcome] = await Promise.all([
        picks.originOf(),
        tickets.ticketFor({ mediaId, isFresh: true }),
      ])
      if (outcome.kind !== TICKET_OUTCOMES.ticket) return mintRefusalOf(outcome)
      return { ok: true, access: { url, ticket: outcome.ticket } }
    },
    forget: picks.forget,
  }
}
