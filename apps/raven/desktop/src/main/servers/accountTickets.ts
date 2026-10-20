import { AUTH_REFUSALS, isMediaTicket, LOCKED_STATUS, type AuthRefusal } from '@raven/core'
import {
  type AccountSessions,
  TICKET_MIN_VALIDITY_MS,
  TOKEN_READS,
} from '@/main/accounts/accountSessions'
import { parseJson } from '@/main/parseJson'
import { CALL_NAMES } from '@/main/servers/allowlist'
import { accountRefusalOf } from '@/main/servers/authRefusals'
import type { ServerCallResult, ServerCalls } from '@/main/servers/serverCalls'
import { HTTP_STATUSES } from '@/shared/httpStatuses'

/**
 * How long a minted account ticket is used before another is minted: a minute short of the
 * server's five, timed by raven player's own clock, never by the `expiresAt` the server names.
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
  | { kind: typeof TICKET_OUTCOMES.refused; reason: AuthRefusal['reason'] }
  | { kind: typeof TICKET_OUTCOMES.locked }
  | { kind: typeof TICKET_OUTCOMES.gone }
  | { kind: typeof TICKET_OUTCOMES.unreachable }

export type AccountTickets = {
  /** `isFresh` mints another even inside the window: the one held was just refused. */
  ticketFor: (input: {
    serverId: string
    mediaId: number
    isFresh: boolean
  }) => Promise<TicketOutcome>
  /** Drops what is held for a server whose access ended. */
  forget: (serverId: string) => void
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
    case HTTP_STATUSES.forbidden:
      return { kind: TICKET_OUTCOMES.refused, reason: accountRefusalOf(reply) }
    case LOCKED_STATUS:
      return { kind: TICKET_OUTCOMES.locked }
    case HTTP_STATUSES.notFound:
      return { kind: TICKET_OUTCOMES.gone }
    // A 503 (accounts down) or a proxy's 5xx is an outage, not a refusal of this account.
    default:
      return UNREACHABLE
  }
}

type Held = { serverId: string; ticket: string; renewAt: number }
type Minting = { serverId: string; outcome: Promise<TicketOutcome> }

const keyOf = ({ serverId, mediaId }: { serverId: string; mediaId: number }): string =>
  `${serverId}/${mediaId}`

/**
 * Account tickets for main's own media requests: the relay's and the downloads'. One is held per
 * title and reused until `ACCOUNT_TICKET_RENEW_MS` has passed; one mint at most is in flight per title.
 * A ticket never leaves main: it goes on the server's URL in main's own fetch.
 */
export const createAccountTickets = ({
  calls,
  sessions,
  now,
}: {
  calls: Pick<ServerCalls, 'call'>
  sessions: Pick<AccountSessions, 'accessToken'>
  now: () => number
}): AccountTickets => {
  let held: ReadonlyMap<string, Held> = new Map()
  let minting: ReadonlyMap<string, Minting> = new Map()

  const mint = async ({
    serverId,
    mediaId,
  }: {
    serverId: string
    mediaId: number
  }): Promise<TicketOutcome> => {
    const token = await sessions.accessToken({ serverId, minValidityMs: TICKET_MIN_VALIDITY_MS })
    switch (token.kind) {
      case TOKEN_READS.none:
        return { kind: TICKET_OUTCOMES.refused, reason: AUTH_REFUSALS.signedOut }
      // Auth could not renew a token that ran out: an outage to wait out, not a sign out.
      case TOKEN_READS.unreachable:
        return UNREACHABLE
      case TOKEN_READS.token:
        return outcomeOf(
          await calls.call({ serverId, call: { name: CALL_NAMES.getAccountTicket, mediaId } }),
        )
      default: {
        const unreachable: never = token
        return unreachable
      }
    }
  }

  const start = ({ serverId, mediaId }: { serverId: string; mediaId: number }) => {
    const key = keyOf({ serverId, mediaId })
    const startedAt = now()
    const outcome = mint({ serverId, mediaId }).catch(() => UNREACHABLE)
    const entry: Minting = { serverId, outcome }
    minting = new Map([...minting, [key, entry]])
    return outcome.then((settled) => {
      // A server forgotten while this was out keeps nothing from it.
      if (minting.get(key) !== entry) return settled
      minting = new Map([...minting].filter(([known]) => known !== key))
      const time = now()
      const live = [...held].filter(([known, ticket]) => known !== key && ticket.renewAt > time)
      held = new Map(
        settled.kind === TICKET_OUTCOMES.ticket
          ? [
              ...live,
              [
                key,
                { serverId, ticket: settled.ticket, renewAt: startedAt + ACCOUNT_TICKET_RENEW_MS },
              ],
            ]
          : live,
      )
      return settled
    })
  }

  return {
    ticketFor: ({ serverId, mediaId, isFresh }) => {
      const key = keyOf({ serverId, mediaId })
      const inFlight = minting.get(key)
      if (inFlight !== undefined) return inFlight.outcome
      const kept = held.get(key)
      if (!isFresh && kept !== undefined && now() < kept.renewAt) {
        return Promise.resolve({ kind: TICKET_OUTCOMES.ticket, ticket: kept.ticket })
      }
      return start({ serverId, mediaId })
    },
    forget: (serverId) => {
      held = new Map([...held].filter(([, ticket]) => ticket.serverId !== serverId))
      minting = new Map([...minting].filter(([, entry]) => entry.serverId !== serverId))
    },
  }
}
