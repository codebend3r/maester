import { Inject, Injectable } from '@nestjs/common'
import { AUTH_REFUSALS, MEMBER_STATUSES, type Account } from '@raven/core'
import { AuthBackend } from '@/auth/authBackend'
import { authFailure } from '@/auth/authFailure'
import type { createTokenVerifier } from '@/auth/tokenVerifier'

export const AUTH_VERIFY = Symbol('AUTH_VERIFY')
const CALLERS = { session: 'session', ticket: 'ticket' } as const

type Session = Awaited<ReturnType<AuthSessions['authenticate']>>
type Caller =
  | { kind: typeof CALLERS.session; session: Session }
  | { kind: typeof CALLERS.ticket; account: Account }

export const requireApproved = (account: Account): void => {
  switch (account.status) {
    case MEMBER_STATUSES.approved:
      return
    case MEMBER_STATUSES.pending:
      throw authFailure(AUTH_REFUSALS.pending)
    case MEMBER_STATUSES.revoked:
      throw authFailure(AUTH_REFUSALS.revoked)
    default: {
      const unreachable: never = account.status
      throw new Error(`Unknown membership: ${unreachable}`)
    }
  }
}

@Injectable()
export class AuthSessions {
  private readonly callers = new WeakMap<object, Caller>()

  constructor(
    @Inject(AUTH_VERIFY) private readonly verify: ReturnType<typeof createTokenVerifier>,
    @Inject(AuthBackend) private readonly backend: AuthBackend,
  ) {}

  async authenticate({ token }: { token: string }) {
    const identity = await this.verify({ token })
    const account = await this.backend.current({ token })
    if (account === null) throw authFailure(AUTH_REFUSALS.pending)
    if (account.id !== identity.id) throw authFailure(AUTH_REFUSALS.unavailable)
    return { account, token, expiresAt: identity.expiresAt }
  }

  bindSession({ request, session }: { request: object; session: Session }): void {
    this.callers.set(request, { kind: CALLERS.session, session })
  }

  bindTicket({ request, account }: { request: object; account: Account }): void {
    this.callers.set(request, { kind: CALLERS.ticket, account })
  }

  sessionOf({ request }: { request: object }): Session {
    const caller = this.callers.get(request)
    if (caller === undefined || caller.kind !== CALLERS.session)
      throw authFailure(AUTH_REFUSALS.signedOut)
    return caller.session
  }

  isTicket({ request }: { request: object }): boolean {
    return (this.callers.get(request)?.kind ?? null) === CALLERS.ticket
  }
}
