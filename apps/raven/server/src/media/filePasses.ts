import { createHash } from 'node:crypto'
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common'
import { isString } from '@raven/core'
import { AccessRechecks } from '@/auth/accessRechecks'
import { AUTH_ENCODINGS } from '@/auth/accessToken'
import { type AccountPass, type PassGrant, openPass, ticketAccessOf } from '@/auth/accountPasses'
import { ACCOUNT_TICKET_PREFIX } from '@/auth/accountTickets'
import { AuthSessions } from '@/auth/authSessions'
import { CLOCK, type Clock } from '@/clock'
import { LockService } from '@/lock/lockService'

/** How many passes the server holds in all; one more lets go of the least recently used. */
export const FILE_PASS_CAP = 256

/**
 * How many one account holds; one more lets go of that account's least
 * recently used, so one account's plays never end another's. A player
 * mints a ticket for each source, so a few plays and reopens fit.
 */
export const FILE_PASSES_PER_ACCOUNT = 8

type Held = {
  accountId: string
  mediaId: number
  /** Null only while the pass opens, which may end it at once. */
  pass: AccountPass | null
  lastUsedAt: number
}

/** Ends a held pass; the pass then has it forgotten. */
const endHeld = (record: Held): void => {
  if (record.pass !== null) record.pass.end()
}

const endLeastRecentlyUsed = (records: readonly Held[]): void => {
  const [oldest] = records.toSorted((a, b) => a.lastUsedAt - b.lastUsedAt)
  if (oldest !== undefined) endHeld(oldest)
}

/** What a ticket is held under: its digest, so the map's lookup never compares the ticket itself. */
const digestOf = (ticket: string): string =>
  createHash('sha256').update(ticket).digest(AUTH_ENCODINGS.base64url)

/**
 * The account passes direct play earns. A native player keeps the address
 * it opened a file with and asks it for ranges for as long as it plays, so
 * once an account ticket has opened its file, that ticket goes on opening
 * that file for its account past the ticket's five minutes, on a pass with
 * an HLS session's rules: `ACCOUNT_PASS_MS` from that first open, rechecked
 * with the account, and ended as its account loses access, or, on a locked
 * library, as the PIN unlock it was minted under goes. The same ticket
 * opens nothing more on any other media or route. Passes live in memory
 * alone, so a restart ends every one and the player's reopen mints a new
 * ticket.
 */
@Injectable()
export class FilePasses implements OnModuleDestroy {
  private readonly held = new Map<string, Held>()

  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AuthSessions) private readonly callers: Pick<AuthSessions, 'callerOf'>,
    @Inject(AccessRechecks) private readonly rechecks: Pick<AccessRechecks, 'ended'>,
    @Inject(LockService) private readonly lock: Pick<LockService, 'relocks' | 'unlockNeedOf'>,
  ) {}

  /**
   * Holds a pass for `ticket` on media `mediaId`, once the account gate let
   * the request through on that account ticket or its pass. Another
   * caller, a legacy ticket or none hold nothing. A ticket already held
   * keeps the deadline of its first open.
   */
  hold({ request, ticket, mediaId }: { request: object; ticket: unknown; mediaId: number }): void {
    if (!isString(ticket) || !ticket.startsWith(ACCOUNT_TICKET_PREFIX)) return
    const digest = digestOf(ticket)
    if (this.grantOf({ ticket, mediaId }) !== null) return
    const access = ticketAccessOf({
      request,
      mediaId,
      callers: this.callers,
      rechecks: this.rechecks,
      lock: this.lock,
    })
    if (access === null) return
    this.makeRoom({ accountId: access.account.id })
    const record: Held = {
      accountId: access.account.id,
      mediaId,
      pass: null,
      lastUsedAt: this.clock.now(),
    }
    this.held.set(digest, record)
    record.pass = openPass({
      secret: ticket,
      mediaId,
      access,
      clock: this.clock,
      onEnd: () => this.forget({ digest, record }),
    })
  }

  /** What `ticket`'s pass lets a request for media `mediaId`'s file through as, or null when it holds none. */
  grantOf({ ticket, mediaId }: { ticket: string; mediaId: number }): PassGrant | null {
    const record = this.held.get(digestOf(ticket))
    const grant = record?.pass?.grantFor({ given: ticket, mediaId }) ?? null
    if (record !== undefined && grant !== null) record.lastUsedAt = this.clock.now()
    return grant
  }

  /** Ends every pass on a media whose file is gone. */
  drop({ mediaId }: { mediaId: number }): void {
    ;[...this.held.values()].filter((record) => record.mediaId === mediaId).forEach(endHeld)
  }

  onModuleDestroy(): void {
    ;[...this.held.values()].forEach(endHeld)
  }

  private forget({ digest, record }: { digest: string; record: Held }): void {
    if (this.held.get(digest) === record) this.held.delete(digest)
  }

  /** Ends the least recently used pass of the account at its share, else of all at the cap. */
  private makeRoom({ accountId }: { accountId: string }): void {
    const all = [...this.held.values()]
    const own = all.filter((record) => record.accountId === accountId)
    if (own.length >= FILE_PASSES_PER_ACCOUNT) return endLeastRecentlyUsed(own)
    if (all.length >= FILE_PASS_CAP) endLeastRecentlyUsed(all)
  }
}
