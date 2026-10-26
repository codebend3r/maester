import { createHash } from 'node:crypto'
import { Inject, Injectable } from '@nestjs/common'
import type { Account } from '@raven/core'
import { AUTH_ENCODINGS } from '@/auth/accessToken'
import { AuthBackend } from '@/auth/authBackend'

export const MEMBERSHIP_TTL = Symbol('MEMBERSHIP_TTL')
/** How long a membership answer is reused (D2); a change in the database shows within this long. */
export const MEMBERSHIP_TTL_MS = 5_000
/** How many tokens' answers are held at once; past it the oldest go first. */
export const MAX_LOOKUPS = 4096

/** A lookup: when it began, its answer, and whose membership it found once it has (null for none). */
type Entry = {
  startedAt: number
  result: Promise<Account | null>
  answered: { accountId: string | null } | null
}

type MembershipLookupsCurrentProps = { token: string }

type MembershipLookupsForgetProps = { accountId: string }

type MembershipLookupsSettleProps = { key: string; entry: Entry }

type MembershipLookupsAskProps = { token: string }

type MembershipLookupsStoreProps = { key: string; entry: Entry; now: number }

type MembershipLookupsIsFreshProps = { entry: Entry; now: number }

/**
 * `current_membership` lookups, shared. Callers with the same token share
 * one lookup while it is in flight, and its answer is reused until the TTL
 * since it began is up, so a page of requests costs one RPC. A failed
 * lookup is never kept: the next call asks again.
 */
@Injectable()
export class MembershipLookups {
  private readonly entries = new Map<string, Entry>()

  constructor(
    @Inject(AuthBackend) private readonly backend: Pick<AuthBackend, 'current'>,
    @Inject(MEMBERSHIP_TTL) private readonly ttlMs: number,
  ) {}

  current({ token }: MembershipLookupsCurrentProps): Promise<Account | null> {
    const key = createHash('sha256').update(token).digest(AUTH_ENCODINGS.base64url)
    const now = Date.now()
    const held = this.entries.get(key)
    if (held !== undefined && this.isFresh({ entry: held, now })) return held.result
    const entry: Entry = { startedAt: now, result: this.ask({ token }), answered: null }
    this.store({ key, entry, now })
    // Settled once stored, so even a backend that throws at once is dropped; it never rejects.
    this.settle({ key, entry }).catch(() => undefined)
    return entry.result
  }

  /**
   * Drops every answer held for the account, whichever token asked, so its
   * next request is looked up afresh. Lookups still in flight go too: their
   * token's account is not known yet, and one may have begun before the
   * change it is forgotten for.
   */
  forget({ accountId }: MembershipLookupsForgetProps): void {
    this.entries.forEach((entry, key) => {
      if (entry.answered === null || entry.answered.accountId === accountId)
        this.entries.delete(key)
    })
  }

  /**
   * Whether an answer may be reused: begun within the TTL, and not after
   * `now`. One begun after it is from a clock since set back (a test's
   * faked one, or a host's corrected one), and is asked again rather than
   * held until real time catches up with it.
   */
  private isFresh({ entry, now }: MembershipLookupsIsFreshProps): boolean {
    const age = now - entry.startedAt
    return age >= 0 && age < this.ttlMs
  }

  /** Notes whose membership the lookup found, or drops it once it fails, so a failure is never reused. */
  private async settle({ key, entry }: MembershipLookupsSettleProps): Promise<void> {
    try {
      const account = await entry.result
      entry.answered = { accountId: account?.id ?? null }
    } catch {
      if (this.entries.get(key) === entry) this.entries.delete(key)
    }
  }

  /** The backend's answer, a failure thrown before it returns a promise included, as a promise. */
  private async ask({ token }: MembershipLookupsAskProps): Promise<Account | null> {
    return this.backend.current({ token })
  }

  private store({ key, entry, now }: MembershipLookupsStoreProps): void {
    this.entries.delete(key)
    if (this.entries.size >= MAX_LOOKUPS) {
      this.entries.forEach((held, heldKey) => {
        if (!this.isFresh({ entry: held, now })) this.entries.delete(heldKey)
      })
    }
    if (this.entries.size >= MAX_LOOKUPS) {
      const [oldest] = this.entries.keys()
      if (oldest !== undefined) this.entries.delete(oldest)
    }
    this.entries.set(key, entry)
  }
}
