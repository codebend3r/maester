import { describe, expect, it } from 'bun:test'
import { AUTH_REFUSALS, MEDIA_TICKET_REFRESH_SECONDS, MEDIA_TICKET_SECONDS } from '@/contract'
import {
  ACCOUNT_ACCESS_MESSAGES,
  MEDIA_PROBE_TIMEOUT_MS,
  MEDIA_TICKET_RENEW_MS,
  accountAccessMessageOf,
  ticketRenewAt,
} from '@/mediaAccess'

describe('ticketRenewAt', () => {
  it('renews a ticket its refresh margin short of its life, counted from the read', () => {
    expect(MEDIA_TICKET_RENEW_MS).toBe((MEDIA_TICKET_SECONDS - MEDIA_TICKET_REFRESH_SECONDS) * 1000)
    expect(ticketRenewAt({ readAt: 1_000 })).toBe(1_000 + MEDIA_TICKET_RENEW_MS)
  })
})

describe('MEDIA_PROBE_TIMEOUT_MS', () => {
  it('gives an origin two seconds to answer its ping, on every client', () => {
    expect(MEDIA_PROBE_TIMEOUT_MS).toBe(2000)
  })
})

describe('accountAccessMessageOf', () => {
  const name = 'Vhagar'

  it("asks a signed out account to sign in again, in raven player's words", () => {
    expect(accountAccessMessageOf({ reason: AUTH_REFUSALS.signedOut, name })).toBe(
      'Sign in to Vhagar again.',
    )
    expect(ACCOUNT_ACCESS_MESSAGES.signInAgain(name)).toBe('Sign in to Vhagar again.')
  })

  it('tells an account sent back to waiting, revoked or no longer the owner that its access went', () => {
    const reasons = [AUTH_REFUSALS.pending, AUTH_REFUSALS.revoked, AUTH_REFUSALS.notOwner]
    expect(reasons.map((reason) => accountAccessMessageOf({ reason, name }))).toEqual(
      reasons.map(() => 'Your access to Vhagar was removed.'),
    )
  })

  it('has no words for accounts that are down, an outage rather than a refusal', () => {
    expect(accountAccessMessageOf({ reason: AUTH_REFUSALS.unavailable, name })).toBeNull()
  })
})
