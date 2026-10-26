import { createHash } from 'node:crypto'
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common'
import { isString } from '@raven/core'
import { AsyncSubject, NEVER, type Observable } from 'rxjs'
import { AUTH_ENCODINGS } from '@/auth/accessToken'
import { type AccountPass, type PassGrant, openPass } from '@/auth/accountPasses'
import { ACCOUNT_TICKET_PREFIX } from '@/auth/accountTickets'
import { TicketAccesses } from '@/auth/ticketAccesses'
import { CLOCK, type Clock } from '@/clock'

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
  /** Emits once the pass has ended, however it ended, so the responses it opened are cut. */
  ended: AsyncSubject<void>
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

type FilePassesMakeRoomProps = { accountId: string }

type FilePassesForgetProps = { digest: string; record: Held }

type FilePassesDropProps = { mediaId: number }

type FilePassesGrantOfProps = { ticket: string; mediaId: number }

type FilePassesHoldProps = {
  request: object
  ticket: unknown
  mediaId: number
}

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
    @Inject(TicketAccesses) private readonly accesses: Pick<TicketAccesses, 'accessOf'>,
  ) {}

  /**
   * Holds a pass for `ticket` on media `mediaId`, once the account gate let
   * the request through on that account ticket or its pass, and answers
   * what emits as that pass ends, so the response it opened is cut then.
   * Another caller, a legacy ticket or none hold nothing, and nothing ends
   * their response here. A ticket already held keeps the deadline of its
   * first open.
   */
  hold({ request, ticket, mediaId }: FilePassesHoldProps): Observable<void> {
    if (!isString(ticket) || !ticket.startsWith(ACCOUNT_TICKET_PREFIX)) return NEVER
    const digest = digestOf(ticket)
    const kept = this.held.get(digest)
    if (kept !== undefined && this.grantOf({ ticket, mediaId }) !== null)
      return kept.ended.asObservable()
    const access = this.accesses.accessOf({ request, mediaId })
    if (access === null) return NEVER
    this.makeRoom({ accountId: access.account.id })
    const record: Held = {
      accountId: access.account.id,
      mediaId,
      pass: null,
      lastUsedAt: this.clock.now(),
      ended: new AsyncSubject<void>(),
    }
    this.held.set(digest, record)
    record.pass = openPass({
      secret: ticket,
      mediaId,
      access,
      clock: this.clock,
      onEnd: () => this.forget({ digest, record }),
    })
    return record.ended.asObservable()
  }

  /** What `ticket`'s pass lets a request for media `mediaId`'s file through as, or null when it holds none. */
  grantOf({ ticket, mediaId }: FilePassesGrantOfProps): PassGrant | null {
    const record = this.held.get(digestOf(ticket))
    const grant = record?.pass?.grantFor({ given: ticket, mediaId }) ?? null
    if (record !== undefined && grant !== null) record.lastUsedAt = this.clock.now()
    return grant
  }

  /** Ends every pass on a media whose file is gone. */
  drop({ mediaId }: FilePassesDropProps): void {
    ;[...this.held.values()].filter((record) => record.mediaId === mediaId).forEach(endHeld)
  }

  onModuleDestroy(): void {
    ;[...this.held.values()].forEach(endHeld)
  }

  private forget({ digest, record }: FilePassesForgetProps): void {
    if (this.held.get(digest) === record) this.held.delete(digest)
    record.ended.next()
    record.ended.complete()
  }

  /** Ends the least recently used pass of the account at its share, else of all at the cap. */
  private makeRoom({ accountId }: FilePassesMakeRoomProps): void {
    const all = [...this.held.values()]
    const own = all.filter((record) => record.accountId === accountId)
    if (own.length >= FILE_PASSES_PER_ACCOUNT) return endLeastRecentlyUsed(own)
    if (all.length >= FILE_PASS_CAP) endLeastRecentlyUsed(all)
  }
}
