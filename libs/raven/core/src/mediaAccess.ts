import {
  AUTH_REFUSALS,
  type AuthRefusal,
  MEDIA_TICKET_REFRESH_SECONDS,
  MEDIA_TICKET_SECONDS,
} from '@/contract'

/** How long after it was read a client renews a media ticket. */
export const MEDIA_TICKET_RENEW_MS = (MEDIA_TICKET_SECONDS - MEDIA_TICKET_REFRESH_SECONDS) * 1000

/**
 * When a ticket read at `readAt` is renewed, in epoch ms by the client's own clock. Timed from the
 * read, never from `expiresAt`, so a clock off the server's changes nothing.
 */
export const ticketRenewAt = ({ readAt }: { readAt: number }): number =>
  readAt + MEDIA_TICKET_RENEW_MS

/** How long a client waits on one origin's ping before it counts the origin as not answering. */
export const MEDIA_PROBE_TIMEOUT_MS = 2000

/** Why a client cannot reach a video's media. */
export const ACCESS_REFUSALS = {
  locked: 'locked',
  unreachable: 'unreachable',
  unreadable: 'unreadable',
  gone: 'gone',
  account: 'account',
} as const

export type AccessRefusalReason = (typeof ACCESS_REFUSALS)[keyof typeof ACCESS_REFUSALS]

/** A video's media out of reach: why, and the words a viewer reads. */
export type AccessRefusal = { ok: false; reason: AccessRefusalReason; message: string }

/** What a player says when the server refuses the account its media is played under, on every client. */
export const ACCOUNT_ACCESS_MESSAGES = {
  signInAgain: (name: string): string => `Sign in to ${name} again.`,
  removed: (name: string): string => `Your access to ${name} was removed.`,
} as const

/**
 * The words for media the server refused the account on `name` for; null for `unavailable`,
 * accounts being down, which is an outage rather than a refusal of this one. An account sent back
 * to waiting has lost the access it had, as a revoked one has.
 */
export const accountAccessMessageOf = ({
  reason,
  name,
}: {
  reason: AuthRefusal['reason']
  name: string
}): string | null => {
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
