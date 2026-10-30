import { describe, expect, it } from 'bun:test'
import {
  ACCOUNT_TICKET_SECONDS,
  MEDIA_TICKET_REFRESH_SECONDS,
  MEDIA_TICKET_SECONDS,
} from '@/contract'
import { MEDIA_PROBE_TIMEOUT_MS, TICKET_RENEW_MS, ticketRenewAt } from '@/mediaAccess'

describe('ticketRenewAt', () => {
  it('renews a ticket its refresh margin short of its life, counted from the read', () => {
    // Inside an account ticket's five minutes, and well inside a shared ticket's six hours.
    expect(TICKET_RENEW_MS).toBe((ACCOUNT_TICKET_SECONDS * 1000 * 2) / 5)
    expect(TICKET_RENEW_MS).toBeLessThan(
      (MEDIA_TICKET_SECONDS - MEDIA_TICKET_REFRESH_SECONDS) * 1000,
    )
    expect(ticketRenewAt({ readAt: 1_000 })).toBe(1_000 + TICKET_RENEW_MS)
  })
})

describe('MEDIA_PROBE_TIMEOUT_MS', () => {
  it('gives an origin six seconds to answer its ping, on every client, so a busy home network still wins', () => {
    expect(MEDIA_PROBE_TIMEOUT_MS).toBe(6000)
  })
})
