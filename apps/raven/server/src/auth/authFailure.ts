import { HttpException } from '@nestjs/common'
import { AUTH_REFUSALS, type AuthRefusal } from '@raven/core'

const FAILURES = {
  [AUTH_REFUSALS.signedOut]: { status: 401, message: 'Sign in to continue.' },
  [AUTH_REFUSALS.pending]: { status: 403, message: 'Your account is awaiting approval.' },
  [AUTH_REFUSALS.revoked]: { status: 403, message: 'Your access has been removed.' },
  [AUTH_REFUSALS.notOwner]: { status: 403, message: 'Only the owner can manage accounts.' },
  [AUTH_REFUSALS.unavailable]: {
    status: 503,
    message: 'Account access is temporarily unavailable.',
  },
} as const

export const authFailure = (reason: AuthRefusal['reason']): HttpException => {
  const { status, message } = FAILURES[reason]
  return new HttpException({ reason, message } satisfies AuthRefusal, status)
}

/** The ways a membership answer can be one raven must not trust. */
export const INTEGRITY_FAILURES = {
  accountMismatch: 'account mismatch',
  ambiguousMembership: 'ambiguous membership',
  malformedMembership: 'malformed membership',
} as const

export type IntegrityFailureKind = (typeof INTEGRITY_FAILURES)[keyof typeof INTEGRITY_FAILURES]

type IntegrityFailureProps = { failure: IntegrityFailureKind }

/**
 * A membership answer that cannot be trusted: for another account, for
 * several, or not shaped like a membership. Clients are told only that
 * accounts are unavailable, as for an outage, but it is an integrity
 * failure, not an outage: an open response never outlasts one.
 */
export class IntegrityFailure extends HttpException {
  readonly failure: IntegrityFailureKind

  constructor({ failure }: IntegrityFailureProps) {
    const { status, message } = FAILURES[AUTH_REFUSALS.unavailable]
    super({ reason: AUTH_REFUSALS.unavailable, message } satisfies AuthRefusal, status)
    this.failure = failure
  }
}
