import {
  ACCOUNT_TICKET_SECONDS,
  MEDIA_TICKET_REFRESH_SECONDS,
  MEDIA_TICKET_SECONDS,
} from '@/contract'

/** How long after it was read a client renews a server's shared media ticket, six hours long. */
const MEDIA_TICKET_RENEW_MS = (MEDIA_TICKET_SECONDS - MEDIA_TICKET_REFRESH_SECONDS) * 1000

/** Two fifths of an account ticket's life, two of its five minutes, so a renewal lands well inside it. */
const ACCOUNT_TICKET_RENEW_MS = (ACCOUNT_TICKET_SECONDS * 1000 * 2) / 5

/**
 * How long after it was read a client renews a media ticket, whichever kind the server hands out:
 * inside an account ticket's five minutes. A file the ticket opened stays open past them, but
 * every other route (subtitles, a reopened source) takes only a live ticket.
 */
export const TICKET_RENEW_MS = Math.min(MEDIA_TICKET_RENEW_MS, ACCOUNT_TICKET_RENEW_MS)

type TicketRenewAtProps = { readAt: number }

/**
 * When a ticket read at `readAt` is renewed, in epoch ms by the client's own clock. Timed from the
 * read, never from `expiresAt`, so a clock off the server's changes nothing.
 */
export const ticketRenewAt = ({ readAt }: TicketRenewAtProps): number => readAt + TICKET_RENEW_MS

/**
 * How long a client waits on one origin's ping before it counts the origin as not answering.
 * Long enough for a busy home network: a LAN origin that misses it is passed over for a
 * public one, which carries the video out to the internet and back and makes the network busier.
 */
export const MEDIA_PROBE_TIMEOUT_MS = 6000

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
