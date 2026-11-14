import { AUTH_REFUSALS, isMediaTicket, LOCKED_STATUS } from '@raven/core'
import { parseJson } from '@/main/parseJson'
import { CALL_NAMES } from '@/main/servers/allowlist'
import { accountRefusalOf, type AccountRefusal } from '@/main/servers/authRefusals'
import type { ServerCallResult, ServerCalls } from '@/main/servers/serverCalls'
import { HTTP_STATUSES } from '@shared/http'

/**
 * How long a minted account ticket is used before another is minted: a minute short of the
 * server's five, timed by Raven's own clock, never by the `expiresAt` the server names.
 */
export const ACCOUNT_TICKET_RENEW_MS = 240_000

export const TICKET_OUTCOMES = {
  ticket: 'ticket',
  refused: 'refused',
  locked: 'locked',
  gone: 'gone',
  unreachable: 'unreachable',
} as const

export type TicketOutcome =
  | { kind: typeof TICKET_OUTCOMES.ticket; ticket: string }
  | { kind: typeof TICKET_OUTCOMES.refused; reason: AccountRefusal }
  | { kind: typeof TICKET_OUTCOMES.locked }
  | { kind: typeof TICKET_OUTCOMES.gone }
  | { kind: typeof TICKET_OUTCOMES.unreachable }

type TicketForProps = {
  mediaId: number
  isFresh: boolean
}

export type AccountTickets = {
  /** `isFresh` mints another even inside the window: the one held was just refused. */
  ticketFor: (input: TicketForProps) => Promise<TicketOutcome>
  /** Drops what is held, as the account it was minted for is no longer signed in. */
  forget: () => void
}

const UNREACHABLE: TicketOutcome = { kind: TICKET_OUTCOMES.unreachable }

const outcomeOf = (reply: ServerCallResult): TicketOutcome => {
  if (!reply.ok) return UNREACHABLE
  switch (reply.status) {
    case HTTP_STATUSES.ok: {
      const parsed = parseJson(reply.body)
      return isMediaTicket(parsed)
        ? { kind: TICKET_OUTCOMES.ticket, ticket: parsed.ticket }
        : UNREACHABLE
    }
    case HTTP_STATUSES.unauthorized:
    case HTTP_STATUSES.forbidden: {
      // Accounts that are down are an outage, not a refusal of this account.
      const reason = accountRefusalOf(reply)
      return reason === null ? UNREACHABLE : { kind: TICKET_OUTCOMES.refused, reason }
    }
    case LOCKED_STATUS:
      return { kind: TICKET_OUTCOMES.locked }
    case HTTP_STATUSES.notFound:
      return { kind: TICKET_OUTCOMES.gone }
    // A 503 (accounts down) or a proxy's 5xx is an outage, not a refusal of this account.
    default:
      return UNREACHABLE
  }
}

type Held = { ticket: string; renewAt: number }

type CreateAccountTicketsProps = {
  calls: Pick<ServerCalls, 'call'>
  /** Whether the page is signed in, so a mint has a token to go out with. */
  isSignedIn: () => boolean
  now: () => number
}

/**
 * Account tickets for main's own media requests: the relay's and the downloads'. One is held per
 * title and reused until `ACCOUNT_TICKET_RENEW_MS` has passed; one mint at most is in flight per title.
 * A ticket never leaves main: it goes on the server's URL in main's own fetch.
 */
export const createAccountTickets = ({
  calls,
  isSignedIn,
  now,
}: CreateAccountTicketsProps): AccountTickets => {
  let held: ReadonlyMap<number, Held> = new Map()
  let minting: ReadonlyMap<number, Promise<TicketOutcome>> = new Map()

  const mint = async (mediaId: number): Promise<TicketOutcome> => {
    // Signed out, the server would refuse the mint as signed out too, so main does not ask it.
    if (!isSignedIn()) return { kind: TICKET_OUTCOMES.refused, reason: AUTH_REFUSALS.signedOut }
    return outcomeOf(await calls.call({ call: { name: CALL_NAMES.getAccountTicket, mediaId } }))
  }

  const start = (mediaId: number): Promise<TicketOutcome> => {
    const startedAt = now()
    const outcome = mint(mediaId).catch(() => UNREACHABLE)
    minting = new Map([...minting, [mediaId, outcome]])
    return outcome.then((settled) => {
      // Forgotten while this was out, it keeps nothing.
      if (minting.get(mediaId) !== outcome) return settled
      minting = new Map([...minting].filter(([known]) => known !== mediaId))
      const time = now()
      const live = [...held].filter(([known, ticket]) => known !== mediaId && ticket.renewAt > time)
      held = new Map(
        settled.kind === TICKET_OUTCOMES.ticket
          ? [
              ...live,
              [mediaId, { ticket: settled.ticket, renewAt: startedAt + ACCOUNT_TICKET_RENEW_MS }],
            ]
          : live,
      )
      return settled
    })
  }

  return {
    ticketFor: ({ mediaId, isFresh }) => {
      const inFlight = minting.get(mediaId)
      if (inFlight !== undefined) return inFlight
      const kept = held.get(mediaId)
      if (!isFresh && kept !== undefined && now() < kept.renewAt) {
        return Promise.resolve({ kind: TICKET_OUTCOMES.ticket, ticket: kept.ticket })
      }
      return start(mediaId)
    },
    forget: () => {
      held = new Map()
      minting = new Map()
    },
  }
}
