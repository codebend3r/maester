import { randomBytes } from 'node:crypto'
import { Inject, Injectable } from '@nestjs/common'
import { ACCOUNT_TICKET_SECONDS, AUTH_REFUSALS, type MediaTicket } from '@raven/core'
import type { FastifyRequest } from 'fastify'
import { authFailure } from '@/auth/authFailure'
import { AUTH_ENCODINGS } from '@/auth/accessToken'
import { AuthSessions, CALLERS, requireApproved } from '@/auth/authSessions'
import { LockService } from '@/lock/lockService'

export const ACCOUNT_TICKET_PREFIX = 'account.'
const TICKET_MS = ACCOUNT_TICKET_SECONDS * 1000
const MAX_TICKETS = 2048
const MAX_ACCOUNT_TICKETS = 32

type Session = ReturnType<AuthSessions['sessionOf']>

type Entry = {
  id: number
  accountId: string
  token: string
  expiresAt: number
  unlockedUntil: number | null
}

/** What a redeemed ticket stands for: the session it was minted from, rechecked, and the PIN unlock it was minted under. */
type Redemption = { session: Session; unlockedUntil: number | null }

type AccountTicketsIssueProps = {
  id: number
  request: Pick<FastifyRequest, 'headers'>
  now?: number
}

type AccountTicketsRedeemProps = {
  ticket: string
  id: number
  now?: number
}

/** Opaque, process-local capabilities; no JWT or refresh credential enters a media URL. */
@Injectable()
export class AccountTickets {
  private entries = new Map<string, Entry>()

  constructor(
    @Inject(AuthSessions) private readonly sessions: Pick<
      AuthSessions,
      'authenticate' | 'callerOf'
    >,
    @Inject(LockService) private readonly lock: Pick<LockService, 'unlockedUntil'>,
  ) {}

  /**
   * Mints a ticket for the caller the account gate bound to `request`. Only
   * a session sent by Bearer mints: the cookie alone never does, on the GET
   * route as on the POST. An owner past the PIN passes that unlock on to the
   * ticket, for as long as it holds.
   */
  issue({ id, request, now = Date.now() }: AccountTicketsIssueProps): MediaTicket {
    const caller = this.sessions.callerOf({ request })
    if (caller.kind !== CALLERS.session || !caller.isBearer) {
      throw authFailure(AUTH_REFUSALS.signedOut)
    }
    const { session } = caller
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
    this.entries.set(ticket, {
      id,
      token: session.token,
      accountId: session.account.id,
      expiresAt,
      unlockedUntil: this.lock.unlockedUntil({ request }),
    })
    return { ticket, expiresAt }
  }

  async redeem({ ticket, id, now = Date.now() }: AccountTicketsRedeemProps): Promise<Redemption> {
    const entry = this.entries.get(ticket)
    if (entry === undefined || entry.id !== id || entry.expiresAt <= now) {
      throw authFailure(AUTH_REFUSALS.signedOut)
    }
    // Recheck with the user's JWT on every redemption, so removal takes effect
    // before the next range, stream or subtitle request, without privileged keys.
    const session = await this.sessions.authenticate({ token: entry.token })
    requireApproved(session.account)
    return { session, unlockedUntil: entry.unlockedUntil }
  }
}
