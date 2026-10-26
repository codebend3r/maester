import { Inject, Injectable } from '@nestjs/common'
import { AUTH_REFUSALS, MEMBER_STATUSES, type Account } from '@raven/core'
import type { PassGrant } from '@/auth/accountPasses'
import { INTEGRITY_FAILURES, IntegrityFailure, authFailure } from '@/auth/authFailure'
import { MembershipLookups } from '@/auth/membershipLookups'
import type { createTokenVerifier } from '@/auth/tokenVerifier'

export const AUTH_VERIFY = Symbol('AUTH_VERIFY')
export const CALLERS = { legacy: 'legacy', session: 'session', ticket: 'ticket' } as const

type Session = Awaited<ReturnType<AuthSessions['authenticate']>>
/** What a ticket's caller keeps of the session it stands for: only the account, never its token. */
type TicketSession = Pick<Session, 'account'>
/**
 * Who a request comes from: the legacy browser of a server without
 * accounts, a session from Bearer or the cookie, or an account ticket with
 * the session it was minted from and, when the owner minted it past the
 * PIN, until when that unlock holds.
 */
export type Caller =
  | { kind: typeof CALLERS.legacy }
  | { kind: typeof CALLERS.session; session: Session; isBearer: boolean }
  | { kind: typeof CALLERS.ticket; session: TicketSession; unlockedUntil: number | null }

const LEGACY: Caller = { kind: CALLERS.legacy }

/** The account a caller stands for, by session or ticket; none for the legacy browser. */
export const accountOf = (caller: Caller): Account | null =>
  caller.kind === CALLERS.legacy ? null : caller.session.account

/** How many accounts' freshest tokens are held at once; past it the others soonest to expire go first. */
export const REMEMBERED_ACCOUNTS = 4096

type Freshest = Pick<Session, 'token' | 'expiresAt'>

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

type AuthSessionsAuthenticateProps = { token: string }

type AuthSessionsFreshestForProps = { accountId: string }

type AuthSessionsReleaseProps = { accountId: string }

type AuthSessionsBindSessionProps = {
  request: object
  session: Session
  isBearer: boolean
}

type AuthSessionsBindTicketProps = { request: object; grant: PassGrant }

type AuthSessionsCallerOfProps = { request: object }

type AuthSessionsSessionOfProps = { request: object }

@Injectable()
export class AuthSessions {
  private readonly callers = new WeakMap<object, Caller>()
  private freshest = new Map<string, Freshest>()

  constructor(
    @Inject(AUTH_VERIFY) private readonly verify: ReturnType<typeof createTokenVerifier>,
    @Inject(MembershipLookups) private readonly lookups: Pick<MembershipLookups, 'current'>,
  ) {}

  async authenticate({ token }: AuthSessionsAuthenticateProps) {
    const identity = await this.verify({ token })
    const account = await this.lookups.current({ token })
    if (account === null) throw authFailure(AUTH_REFUSALS.pending)
    if (account.id !== identity.id)
      throw new IntegrityFailure({ failure: INTEGRITY_FAILURES.accountMismatch })
    const session = { account, token, expiresAt: identity.expiresAt }
    this.remember(session)
    return session
  }

  /**
   * Keeps `token` as an approved account's freshest when it outlives the
   * one held, so an open response stays open for as long as its account
   * keeps calling with live tokens. Only approved accounts are held, so
   * sign-ups waiting for approval cannot crowd them out. Expired entries go
   * whenever one is added.
   */
  remember({ account, token, expiresAt }: Session): void {
    const now = Date.now()
    if (account.status !== MEMBER_STATUSES.approved || expiresAt <= now) return
    const held = this.freshest.get(account.id)
    if (held !== undefined && held.expiresAt >= expiresAt) return
    const others = [...this.freshest]
      .filter(([id, entry]) => id !== account.id && entry.expiresAt > now)
      .toSorted(([, a], [, b]) => b.expiresAt - a.expiresAt)
      .slice(0, REMEMBERED_ACCOUNTS - 1)
    this.freshest = new Map([...others, [account.id, { token, expiresAt }]])
  }

  /** The unexpired token with the latest expiry seen for the account, or null when none is live. */
  freshestFor({ accountId }: AuthSessionsFreshestForProps): Freshest | null {
    const held = this.freshest.get(accountId)
    return held !== undefined && held.expiresAt > Date.now() ? held : null
  }

  /** Lets go of the token held for the account, once it is known to be no longer approved. */
  release({ accountId }: AuthSessionsReleaseProps): void {
    this.freshest = new Map([...this.freshest].filter(([id]) => id !== accountId))
  }

  bindSession({ request, session, isBearer }: AuthSessionsBindSessionProps): void {
    this.callers.set(request, { kind: CALLERS.session, session, isBearer })
  }

  /**
   * Binds the caller a redeemed ticket, or an account pass, stands for: the
   * account of the session it was minted from, rechecked, and its unlock.
   */
  bindTicket({ request, grant }: AuthSessionsBindTicketProps): void {
    this.callers.set(request, {
      kind: CALLERS.ticket,
      session: { account: grant.account },
      unlockedUntil: grant.unlockedUntil,
    })
  }

  /** The caller the account gate bound to `request`; the legacy browser when it bound none. */
  callerOf({ request }: AuthSessionsCallerOfProps): Caller {
    return this.callers.get(request) ?? LEGACY
  }

  sessionOf({ request }: AuthSessionsSessionOfProps): Session {
    const caller = this.callerOf({ request })
    if (caller.kind !== CALLERS.session) throw authFailure(AUTH_REFUSALS.signedOut)
    return caller.session
  }
}
