import { HttpException, Inject, Injectable, Logger } from '@nestjs/common'
import { AUTH_REFUSALS, isAuthRefusal } from '@raven/core'
import { NEVER, Observable } from 'rxjs'
import { IntegrityFailure } from '@/auth/authFailure'
import { AuthSessions, accountOf, requireApproved } from '@/auth/authSessions'

export const ACCESS_RECHECK_MS = Symbol('ACCESS_RECHECK_MS')
/** How often an open SSE or media response checks its account again (D4). */
export const DEFAULT_ACCESS_RECHECK_MS = 60_000

/** What one recheck found: access, its loss, or no answer from the account infrastructure. */
const RECHECKS = { allowed: 'allowed', ended: 'ended', unanswered: 'unanswered' } as const

type Recheck = (typeof RECHECKS)[keyof typeof RECHECKS]

/**
 * What a failed recheck means for the response. Only an outage keeps it,
 * since the response was already authorized; a refusal, an integrity
 * failure or any other error ends it.
 */
const recheckOf = (error: unknown): { recheck: Recheck; reason: string } => {
  if (error instanceof IntegrityFailure) return { recheck: RECHECKS.ended, reason: error.failure }
  if (!(error instanceof HttpException)) {
    return { recheck: RECHECKS.ended, reason: error instanceof Error ? error.name : typeof error }
  }
  const refusal = error.getResponse()
  if (!isAuthRefusal(refusal)) return { recheck: RECHECKS.ended, reason: String(error.getStatus()) }
  return {
    recheck: refusal.reason === AUTH_REFUSALS.unavailable ? RECHECKS.unanswered : RECHECKS.ended,
    reason: refusal.reason,
  }
}

/**
 * Checks the account behind a response that stays open, SSE or media bytes,
 * on a bounded interval. The token checked is the freshest the server has
 * seen for that account, so a client that keeps calling keeps its response,
 * and one gone quiet loses it when that token expires.
 */
@Injectable()
export class AccessRechecks {
  private readonly logger = new Logger(AccessRechecks.name)

  constructor(
    @Inject(AuthSessions)
    private readonly sessions: Pick<AuthSessions, 'authenticate' | 'callerOf' | 'freshestFor'>,
    @Inject(ACCESS_RECHECK_MS) private readonly recheckMs: number,
  ) {}

  /**
   * Emits once, then completes, when the account behind `request` loses
   * access: a recheck refuses it, or no unexpired token for it is left. An
   * outage of the account infrastructure keeps the response and tries again
   * at the next tick, never past the last token's expiry. A legacy caller
   * never ends this way.
   */
  ended({ request }: { request: object }): Observable<void> {
    const account = accountOf(this.sessions.callerOf({ request }))
    if (account === null) return NEVER
    const accountId = account.id
    return new Observable<void>((subscriber) => {
      const timer: { handle: ReturnType<typeof setTimeout> | null } = { handle: null }
      const end = (): void => {
        subscriber.next()
        subscriber.complete()
      }
      const check = async (): Promise<void> => {
        const freshest = this.sessions.freshestFor({ accountId })
        if (freshest === null) return end()
        const recheck = await this.recheck({ token: freshest.token })
        if (subscriber.closed) return
        if (recheck === RECHECKS.ended) return end()
        schedule()
      }
      const schedule = (): void => {
        const freshest = this.sessions.freshestFor({ accountId })
        if (freshest === null) return end()
        const delay = Math.min(this.recheckMs, freshest.expiresAt - Date.now())
        timer.handle = setTimeout(() => {
          check().catch(end)
        }, delay)
      }
      schedule()
      return () => {
        if (timer.handle !== null) clearTimeout(timer.handle)
      }
    })
  }

  /** The membership check one recheck makes, with a warning that names why when it fails. */
  private async recheck({ token }: { token: string }): Promise<Recheck> {
    try {
      const session = await this.sessions.authenticate({ token })
      requireApproved(session.account)
      return RECHECKS.allowed
    } catch (error) {
      const { recheck, reason } = recheckOf(error)
      this.logger.warn(
        recheck === RECHECKS.ended
          ? `Ended an open response whose account lost access: ${reason}`
          : `Could not recheck an open response's account, keeping it: ${reason}`,
      )
      return recheck
    }
  }
}
