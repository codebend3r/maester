import { SetMetadata } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { type Account, isString } from '@raven/core'
import { sameSecret } from '@shared/server'
import { type Observable, filter, map } from 'rxjs'
import type { AccessRechecks } from '@/auth/accessRechecks'
import { type AuthSessions, CALLERS } from '@/auth/authSessions'
import type { Clock } from '@/clock'
import type { LockService } from '@/lock/lockService'
import type { MarkTargets } from '@/routeMarks'

/**
 * How long a pass keeps opening what it opened, from when it opened,
 * however often it is used: a long film with its pauses fits twice over,
 * and a pass that leaks is good for half a day, never days. Past it the
 * player is refused and opens the video again with a new ticket.
 */
export const ACCOUNT_PASS_MS = 12 * 60 * 60 * 1000

/** What a pass lets a request through as: the account and the PIN unlock of the ticket that opened it. */
export type PassGrant = { account: Account; unlockedUntil: number | null }

/** What opens a pass: its grant, when its account loses access, which ends it, and what its unlock rests on. */
export type PassAccess = PassGrant & {
  ended: Observable<void>
  /** Emits as the PIN locks again for the pass's account. */
  relocked: Observable<void>
  /**
   * Whether the pass's media sits in a locked library, asked as its unlock
   * goes rather than read as it opens, since a library may be locked or
   * opened while the pass lives.
   */
  needsUnlock: () => boolean
}

/**
 * An account's way back into one media past its ticket's five minutes,
 * keyed by its secret: an HLS session's capability, or the account ticket
 * that opened a direct file. It ends at `ACCOUNT_PASS_MS` from its open,
 * when its account loses access (the recheck `access.ended` stands for),
 * or when its holder ends it, and is never logged. One opened past the
 * owner's PIN also ends as that unlock goes, by a relock or its lapse,
 * when its media then sits in a locked library; otherwise it plays on
 * without the unlock, so a library locked later holds it as it holds any
 * request.
 */
export type AccountPass = {
  /**
   * The grant, when `given` is the secret, compared in constant time, and
   * `mediaId` the pass's media; null otherwise. Asked at or past its
   * deadline, or past an unlock its locked library needs, it ends the pass,
   * so a host that slept through either timer carries no pass past it.
   */
  grantFor: ({ given, mediaId }: { given: unknown; mediaId: number }) => PassGrant | null
  /** Ends the pass, once: stops its recheck, its relocks and its timers, and tells its holder. */
  end: () => void
}

/**
 * What a request an account ticket opened stands for, to open a pass on
 * media `mediaId` with: the account and unlock the ticket carried,
 * rechecked as an open response is, and the PIN's relocks of that account.
 * Null for any other caller, which earns no pass.
 */
export const ticketAccessOf = ({
  request,
  mediaId,
  callers,
  rechecks,
  lock,
}: {
  request: object
  mediaId: number
  callers: Pick<AuthSessions, 'callerOf'>
  rechecks: Pick<AccessRechecks, 'ended'>
  lock: Pick<LockService, 'relocks' | 'unlockNeedOf'>
}): PassAccess | null => {
  const caller = callers.callerOf({ request })
  if (caller.kind !== CALLERS.ticket) return null
  const { account } = caller.session
  return {
    account,
    unlockedUntil: caller.unlockedUntil,
    ended: rechecks.ended({ request }),
    relocked: lock.relocks.pipe(
      filter((accountId) => accountId === account.id),
      map(() => undefined),
    ),
    needsUnlock: lock.unlockNeedOf({ mediaId }),
  }
}

export const openPass = ({
  secret,
  mediaId,
  access,
  clock,
  onEnd,
}: {
  secret: string
  mediaId: number
  access: PassAccess
  clock: Clock
  /** Called once, however the pass ends, so its holder forgets it. */
  onEnd: () => void
}): AccountPass => {
  const until = clock.now() + ACCOUNT_PASS_MS
  const state: { isOver: boolean; stop: () => void; unlockedUntil: number | null } = {
    isOver: false,
    stop: () => undefined,
    unlockedUntil: access.unlockedUntil,
  }
  const end = (): void => {
    if (state.isOver) return
    state.isOver = true
    state.stop()
    onEnd()
  }
  /** The unlock goes: a pass on a locked library ends, as a fresh request would be refused; any other plays on without it. */
  const loseUnlock = (): void => {
    if (state.unlockedUntil === null) return
    if (access.needsUnlock()) return end()
    state.unlockedUntil = null
  }
  const cancelDeadline = clock.after({ ms: ACCOUNT_PASS_MS, run: end })
  const cancelLapse =
    state.unlockedUntil === null
      ? () => undefined
      : clock.after({ ms: state.unlockedUntil - clock.now(), run: loseUnlock })
  // A recheck that finds no live token for the account ends the pass inside `subscribe`.
  const watch = access.ended.subscribe(end)
  const relock = access.relocked.subscribe(loseUnlock)
  state.stop = () => {
    cancelDeadline()
    cancelLapse()
    watch.unsubscribe()
    relock.unsubscribe()
  }
  if (state.isOver) state.stop()
  const grantFor: AccountPass['grantFor'] = ({ given, mediaId: asked }) => {
    if (state.isOver || asked !== mediaId) return null
    if (!isString(given) || !sameSecret({ given, expected: secret })) return null
    const now = clock.now()
    const hasLapsed = state.unlockedUntil !== null && now >= state.unlockedUntil
    if (now >= until || (hasLapsed && access.needsUnlock())) {
      end()
      return null
    }
    return { account: access.account, unlockedUntil: state.unlockedUntil }
  }
  return { grantFor, end }
}

/** Which pass opens a route: an HLS session's capability, or the pass a ticket earns on its file. */
export const PASS_KINDS = { capability: 'capability', ticket: 'ticket' } as const

export type PassKind = (typeof PASS_KINDS)[keyof typeof PASS_KINDS]

const isPassKind = (value: unknown): value is PassKind =>
  Object.values(PASS_KINDS).some((kind) => kind === value)

const PASS_ROUTE = Symbol('PASS_ROUTE')

/**
 * Marks a route a pass opens once accounts are `ready`: an HLS session's
 * routes, which its capability opens in place of a ticket, or `file`,
 * which a ticket goes on opening past its five minutes once it has.
 */
export const OpenedByPass = (kind: PassKind) => SetMetadata(PASS_ROUTE, kind)

const decorators = new Reflector()

/** The pass that opens a route, or null; read the same by the account gate and the route inventory. */
export const passKindOf = (targets: MarkTargets): PassKind | null => {
  const marked: unknown = decorators.getAllAndOverride(PASS_ROUTE, targets)
  return isPassKind(marked) ? marked : null
}
