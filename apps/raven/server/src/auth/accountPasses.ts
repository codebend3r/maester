import { SetMetadata } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { type Account, isString } from '@raven/core'
import { sameSecret } from '@shared/server'
import type { Observable } from 'rxjs'
import type { AccessRechecks } from '@/auth/accessRechecks'
import { type AuthSessions, CALLERS } from '@/auth/authSessions'
import type { Clock } from '@/clock'
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

/** What opens a pass: its grant, and when its account loses access, which ends it. */
export type PassAccess = PassGrant & { ended: Observable<void> }

/**
 * An account's way back into one media past its ticket's five minutes,
 * keyed by its secret: an HLS session's capability, or the account ticket
 * that opened a direct file. It ends at `ACCOUNT_PASS_MS` from its open,
 * when its account loses access (the recheck `access.ended` stands for),
 * or when its holder ends it, and is never logged.
 */
export type AccountPass = {
  /**
   * The grant, when `given` is the secret, compared in constant time, and
   * `mediaId` the pass's media; null otherwise. Asked at or past its
   * deadline, it ends the pass, so a host that slept through the deadline's
   * timer carries no pass past it.
   */
  grantFor: ({ given, mediaId }: { given: unknown; mediaId: number }) => PassGrant | null
  /** Ends the pass, once: stops its recheck and its deadline, and tells its holder. */
  end: () => void
}

/**
 * What a request an account ticket opened stands for, to open a pass with:
 * the account and unlock the ticket carried, rechecked as an open response
 * is. Null for any other caller, which earns no pass.
 */
export const ticketAccessOf = ({
  request,
  callers,
  rechecks,
}: {
  request: object
  callers: Pick<AuthSessions, 'callerOf'>
  rechecks: Pick<AccessRechecks, 'ended'>
}): PassAccess | null => {
  const caller = callers.callerOf({ request })
  if (caller.kind !== CALLERS.ticket) return null
  return {
    account: caller.session.account,
    unlockedUntil: caller.unlockedUntil,
    ended: rechecks.ended({ request }),
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
  const grant: PassGrant = { account: access.account, unlockedUntil: access.unlockedUntil }
  const until = clock.now() + ACCOUNT_PASS_MS
  const state: { isOver: boolean; stop: () => void } = { isOver: false, stop: () => undefined }
  const end = (): void => {
    if (state.isOver) return
    state.isOver = true
    state.stop()
    onEnd()
  }
  const cancelDeadline = clock.after({ ms: ACCOUNT_PASS_MS, run: end })
  // A recheck that finds no live token for the account ends the pass inside `subscribe`.
  const watch = access.ended.subscribe(end)
  state.stop = () => {
    cancelDeadline()
    watch.unsubscribe()
  }
  if (state.isOver) state.stop()
  const grantFor: AccountPass['grantFor'] = ({ given, mediaId: asked }) => {
    if (state.isOver || asked !== mediaId) return null
    if (!isString(given) || !sameSecret({ given, expected: secret })) return null
    if (clock.now() >= until) {
      end()
      return null
    }
    return grant
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
