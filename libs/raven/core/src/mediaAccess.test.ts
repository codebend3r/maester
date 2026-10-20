import { describe, expect, it } from 'bun:test'
import { MEDIA_TICKET_REFRESH_SECONDS, MEDIA_TICKET_SECONDS } from '@/contract'
import { MEDIA_TICKET_RENEW_MS, ticketRenewAt } from '@/mediaAccess'

describe('ticketRenewAt', () => {
  it('renews a ticket its refresh margin short of its life, counted from the read', () => {
    expect(MEDIA_TICKET_RENEW_MS).toBe((MEDIA_TICKET_SECONDS - MEDIA_TICKET_REFRESH_SECONDS) * 1000)
    expect(ticketRenewAt({ readAt: 1_000 })).toBe(1_000 + MEDIA_TICKET_RENEW_MS)
  })
})
