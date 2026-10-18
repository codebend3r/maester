import { AUTH_REFUSALS, MEMBER_STATUSES } from '@raven/core'
import { describe, expect, it } from 'vitest'
import { AccountTickets } from '@/auth/accountTickets'
import { AuthBackend } from '@/auth/authBackend'
import { AuthSessions } from '@/auth/authSessions'
import { createTokenVerifier } from '@/auth/tokenVerifier'
import { readServerConfig } from '@/config'
import { AUTH_TEST_CONFIG, AUTH_TEST_IDS, authFixture } from '@/test/auth'

const setup = async () => {
  const fixture = await authFixture()
  const backend = new AuthBackend(
    { ...readServerConfig({}), auth: AUTH_TEST_CONFIG },
    fixture.fetcher,
  )
  const sessions = new AuthSessions(
    createTokenVerifier({
      config: AUTH_TEST_CONFIG,
      keys: fixture.keys,
      authFetch: fixture.fetcher,
    }),
    backend,
  )
  const session = await sessions.authenticate({ token: await fixture.mint() })
  return { sessions, session, tickets: new AccountTickets(sessions) }
}

describe('bounded account ticket storage', () => {
  it('caps issuance per account without evicting live tickets, then reclaims expired entries', async () => {
    const { tickets, session } = await setup()
    const now = Date.now()
    const issued = Array.from({ length: 32 }, () => tickets.issue({ id: 7, session, now }))
    expect(() => tickets.issue({ id: 7, session, now })).toThrow()
    await expect(tickets.redeem({ id: 7, ticket: issued[0]!.ticket, now })).resolves.toMatchObject({
      id: session.account.id,
    })
    const renewed = tickets.issue({ id: 7, session, now: now + 300_000 })
    expect(renewed.ticket).not.toBe(issued[0]!.ticket)
    await expect(
      tickets.redeem({ id: 7, ticket: issued[0]!.ticket, now: now + 300_000 }),
    ).rejects.toMatchObject({ response: { reason: AUTH_REFUSALS.signedOut } })
  })

  it('invalidates tickets on server restart and never reuses a capability', async () => {
    const { tickets, sessions, session } = await setup()
    const first = tickets.issue({ id: 7, session })
    const second = tickets.issue({ id: 7, session })
    expect(first.ticket).not.toBe(second.ticket)
    await expect(
      new AccountTickets(sessions).redeem({ ticket: first.ticket, id: 7 }),
    ).rejects.toMatchObject({ response: { reason: AUTH_REFUSALS.signedOut } })
  })

  it('refuses expired sessions, invalid media ids and unapproved issuance', async () => {
    const { tickets, session } = await setup()
    expect(() => tickets.issue({ id: 0, session })).toThrow('Invalid media id')
    expect(() => tickets.issue({ id: 1.5, session })).toThrow('Invalid media id')
    expect(() =>
      tickets.issue({ id: 7, session: { ...session, expiresAt: Date.now() - 1 } }),
    ).toThrow()
    expect(() =>
      tickets.issue({
        id: 7,
        session: {
          ...session,
          account: {
            ...session.account,
            id: AUTH_TEST_IDS.pending,
            status: MEMBER_STATUSES.pending,
          },
        },
      }),
    ).toThrow()
  })
})
