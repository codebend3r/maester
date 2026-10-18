import { randomBytes } from 'node:crypto'
import { Inject, Injectable } from '@nestjs/common'
import { AUTH_REFUSALS, type Account, type MediaTicket } from '@raven/core'
import { authFailure } from '@/auth/authFailure'
import { AUTH_ENCODINGS } from '@/auth/accessToken'
import { AuthSessions, requireApproved } from '@/auth/authSessions'

export const ACCOUNT_TICKET_PREFIX = 'account.'
const TICKET_MS = 5 * 60_000
const MAX_TICKETS = 2048
const MAX_ACCOUNT_TICKETS = 32

type Entry = {
  id: number
  accountId: string
  token: string
  expiresAt: number
}

/** Opaque, process-local capabilities; no JWT or refresh credential enters a media URL. */
@Injectable()
export class AccountTickets {
  private entries = new Map<string, Entry>()

  constructor(@Inject(AuthSessions) private readonly sessions: AuthSessions) {}

  issue({
    id,
    session,
    now = Date.now(),
  }: {
    id: number
    session: ReturnType<AuthSessions['sessionOf']>
    now?: number
  }): MediaTicket {
    requireApproved(session.account)
    const expiresAt = Math.min(now + TICKET_MS, session.expiresAt)
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid media id')
    if (expiresAt <= now) throw authFailure(AUTH_REFUSALS.signedOut)
    this.entries = new Map([...this.entries].filter(([, entry]) => entry.expiresAt > now))
    const accountCount = [...this.entries.values()].filter(
      (entry) => entry.accountId === session.account.id,
    ).length
    if (this.entries.size >= MAX_TICKETS || accountCount >= MAX_ACCOUNT_TICKETS) {
      throw authFailure(AUTH_REFUSALS.unavailable)
    }
    const ticket = `${ACCOUNT_TICKET_PREFIX}${randomBytes(32).toString(AUTH_ENCODINGS.base64url)}`
    this.entries.set(ticket, { id, token: session.token, accountId: session.account.id, expiresAt })
    return { ticket, expiresAt }
  }

  async redeem({
    ticket,
    id,
    now = Date.now(),
  }: {
    ticket: string
    id: number
    now?: number
  }): Promise<Account> {
    const entry = this.entries.get(ticket)
    if (entry === undefined || entry.id !== id || entry.expiresAt <= now) {
      throw authFailure(AUTH_REFUSALS.signedOut)
    }
    // Recheck with the user's JWT on every redemption, so removal takes effect
    // before the next range, stream or subtitle request, without privileged keys.
    const session = await this.sessions.authenticate({ token: entry.token })
    requireApproved(session.account)
    return session.account
  }
}
