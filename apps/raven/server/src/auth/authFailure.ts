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
