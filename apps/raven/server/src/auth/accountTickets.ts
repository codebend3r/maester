import { randomBytes } from 'node:crypto'
import { Inject, Injectable } from '@nestjs/common'
import { ACCOUNT_TICKET_SECONDS, AUTH_REFUSALS, type MediaTicket } from '@raven/core'
import type { FastifyRequest } from 'fastify'
import type { PassGrant } from '@/auth/accountPasses'
import { authFailure } from '@/auth/authFailure'
import { AUTH_ENCODINGS } from '@/auth/accessToken'
import { AuthSessions, CALLERS, requireApproved } from '@/auth/authSessions'
import { LockService } from '@/lock/lockService'

export const ACCOUNT_TICKET_PREFIX = 'account.'
const TICKET_MS = ACCOUNT_TICKET_SECONDS * 1000
const MAX_TICKETS = 2048
const MAX_ACCOUNT_TICKETS = 32

type Entry = {
  id: number
  accountId: string
  token: string
  expiresAt: number
  unlockedUntil: number | null
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
    @Inject(LockService) private readonly lock: Pick<LockService, 'unlockedUntil' | 'relocks'>,
  ) {
    this.lock.relocks.subscribe((accountId) => this.relock({ accountId }))
  }

  /**
   * Mints a ticket for the caller the account gate bound to `request`. Only
   * a session sent by Bearer mints: the cookie alone never does, on the GET
   * route as on the POST. An owner past the PIN passes that unlock on to the
   * ticket, for as long as it holds.
   */
  issue({
    id,
    request,
    now = Date.now(),
  }: {
    id: number
    request: Pick<FastifyRequest, 'headers'>
    now?: number
  }): MediaTicket {
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

  /**
   * Takes the unlock back from the account's live tickets as the PIN locks
   * again for it, so none opens a locked library, or a new pass, past the
   * relock.
   */
  private relock({ accountId }: { accountId: string }): void {
    this.entries = new Map(
      [...this.entries].map(([ticket, entry]): [string, Entry] => [
        ticket,
        entry.accountId === accountId ? { ...entry, unlockedUntil: null } : entry,
      ]),
    )
  }

  /**
   * What a live ticket for media `id` stands for: the account of the
   * session it was minted from, rechecked, and the PIN unlock it was minted
   * under. Null for a ticket that opens nothing (unknown, for another
   * media, or expired), which may still have a pass; a refused account
   * throws its refusal.
   */
  async redeem({
    ticket,
    id,
    now = Date.now(),
  }: {
    ticket: string
    id: number
    now?: number
  }): Promise<PassGrant | null> {
    const entry = this.entries.get(ticket)
    if (entry === undefined || entry.id !== id || entry.expiresAt <= now) return null
    // Recheck with the user's JWT on every redemption, so removal takes effect
    // before the next range, stream or subtitle request, without privileged keys.
    const { account } = await this.sessions.authenticate({ token: entry.token })
    requireApproved(account)
    return { account, unlockedUntil: entry.unlockedUntil }
  }
}
