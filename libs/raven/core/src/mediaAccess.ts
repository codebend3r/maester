import { MEDIA_TICKET_REFRESH_SECONDS, MEDIA_TICKET_SECONDS } from '@/contract'

/** How long after it was read a client renews a media ticket. */
export const MEDIA_TICKET_RENEW_MS = (MEDIA_TICKET_SECONDS - MEDIA_TICKET_REFRESH_SECONDS) * 1000

/**
 * When a ticket read at `readAt` is renewed, in epoch ms by the client's own clock. Timed from the
 * read, never from `expiresAt`, so a clock off the server's changes nothing.
 */
export const ticketRenewAt = ({ readAt }: { readAt: number }): number =>
  readAt + MEDIA_TICKET_RENEW_MS

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
