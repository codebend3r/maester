import { AUTH_REFUSALS, MEMBER_STATUSES } from '@raven/core'
import { Subject } from 'rxjs'
import { describe, expect, it } from 'vitest'
import { AccountTickets } from '@/auth/accountTickets'
import { AuthBackend } from '@/auth/authBackend'
import { authFailure } from '@/auth/authFailure'
import { AuthSessions } from '@/auth/authSessions'
import { MEMBERSHIP_TTL_MS, MembershipLookups } from '@/auth/membershipLookups'
import { createTokenVerifier } from '@/auth/tokenVerifier'
import { AUTH_TEST_CONFIG, AUTH_TEST_IDS, authFixture, bearerHeaders } from '@/test/auth'

type Session = Awaited<ReturnType<AuthSessions['authenticate']>>

const setup = async ({ unlockedUntil = null }: { unlockedUntil?: number | null } = {}) => {
  const fixture = await authFixture()
  const backend = new AuthBackend(AUTH_TEST_CONFIG, fixture.fetcher)
  const sessions = new AuthSessions(
    createTokenVerifier({
      config: AUTH_TEST_CONFIG,
      keys: fixture.keys,
      authFetch: fixture.fetcher,
    }),
    new MembershipLookups(backend, MEMBERSHIP_TTL_MS),
  )
  const session = await sessions.authenticate({ token: await fixture.mint() })
  const lock = { unlockedUntil: () => unlockedUntil, relocks: new Subject<string>() }
  /** A request the account gate bound to `bound`, sent by Bearer unless it says otherwise. */
  const requestFor = ({ bound, isBearer = true }: { bound: Session; isBearer?: boolean }) => {
    const request = { headers: bearerHeaders({ token: bound.token }) }
    sessions.bindSession({ request, session: bound, isBearer })
    return request
  }
  return {
    sessions,
    session,
    request: requestFor({ bound: session }),
    requestFor,
    lock,
    tickets: new AccountTickets(sessions, lock),
  }
}

describe('bounded account ticket storage', () => {
  it('caps issuance per account without evicting live tickets, then reclaims expired entries', async () => {
    const { tickets, session, request } = await setup()
    const now = Date.now()
    const issued = Array.from({ length: 32 }, () => tickets.issue({ id: 7, request, now }))
    expect(() => tickets.issue({ id: 7, request, now })).toThrow()
    await expect(tickets.redeem({ id: 7, ticket: issued[0]!.ticket, now })).resolves.toMatchObject({
      account: { id: session.account.id },
    })
    const renewed = tickets.issue({ id: 7, request, now: now + 300_000 })
    expect(renewed.ticket).not.toBe(issued[0]!.ticket)
    await expect(
      tickets.redeem({ id: 7, ticket: issued[0]!.ticket, now: now + 300_000 }),
    ).resolves.toBeNull()
  })

  it('invalidates tickets on server restart and never reuses a capability', async () => {
    const { tickets, sessions, request, lock } = await setup()
    const first = tickets.issue({ id: 7, request })
    const second = tickets.issue({ id: 7, request })
    expect(first.ticket).not.toBe(second.ticket)
    await expect(
      new AccountTickets(sessions, lock).redeem({ ticket: first.ticket, id: 7 }),
    ).resolves.toBeNull()
  })

  it('refuses expired sessions, invalid media ids and unapproved issuance', async () => {
    const { tickets, session, request, requestFor } = await setup()
    expect(() => tickets.issue({ id: 0, request })).toThrow('Invalid media id')
    expect(() => tickets.issue({ id: 1.5, request })).toThrow('Invalid media id')
    expect(() =>
      tickets.issue({
        id: 7,
        request: requestFor({ bound: { ...session, expiresAt: Date.now() - 1 } }),
      }),
    ).toThrow()
    expect(() =>
      tickets.issue({
        id: 7,
        request: requestFor({
          bound: {
            ...session,
            account: {
              ...session.account,
              id: AUTH_TEST_IDS.pending,
              status: MEMBER_STATUSES.pending,
            },
          },
        }),
      }),
    ).toThrow()
  })

  it('mints only for a session sent by Bearer, never the cookie alone or no session', async () => {
    const { tickets, session, requestFor } = await setup()
    const refusals = [requestFor({ bound: session, isBearer: false }), { headers: {} }].map(
      (request) => () => tickets.issue({ id: 7, request }),
    )
    refusals.forEach((refused) => {
      expect(refused).toThrow(
        expect.objectContaining({
          response: expect.objectContaining({ reason: AUTH_REFUSALS.signedOut }),
        }),
      )
    })
  })

  it('opens nothing for another media, and refuses a removed account', async () => {
    const { tickets, request, sessions, lock } = await setup()
    const { ticket } = tickets.issue({ id: 7, request })
    await expect(tickets.redeem({ id: 8, ticket })).resolves.toBeNull()
    const removed = new AccountTickets(
      {
        callerOf: sessions.callerOf.bind(sessions),
        authenticate: async () => {
          throw authFailure(AUTH_REFUSALS.revoked)
        },
      },
      lock,
    )
    const minted = removed.issue({ id: 7, request })
    await expect(removed.redeem({ id: 7, ticket: minted.ticket })).rejects.toMatchObject({
      response: { reason: AUTH_REFUSALS.revoked },
    })
  })

  it('hands back the PIN unlock the ticket was minted under', async () => {
    const unlockedUntil = Date.now() + 60_000
    const { tickets, request } = await setup({ unlockedUntil })
    const { ticket } = tickets.issue({ id: 7, request })
    await expect(tickets.redeem({ id: 7, ticket })).resolves.toMatchObject({ unlockedUntil })
  })

  it("takes the unlock back from an account's live tickets as the PIN locks again for it, and from no other account's", async () => {
    const unlockedUntil = Date.now() + 60_000
    const { tickets, request, session, lock } = await setup({ unlockedUntil })
    const { ticket } = tickets.issue({ id: 7, request })
    lock.relocks.next(AUTH_TEST_IDS.guest)
    await expect(tickets.redeem({ id: 7, ticket })).resolves.toMatchObject({ unlockedUntil })
    lock.relocks.next(session.account.id)
    await expect(tickets.redeem({ id: 7, ticket })).resolves.toMatchObject({
      account: { id: session.account.id },
      unlockedUntil: null,
    })
  })
})
