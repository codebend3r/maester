import { describe, expect, test } from 'bun:test'
import { AUTH_REFUSALS } from '@raven/core'
import {
  TICKET_MIN_VALIDITY_MS,
  TOKEN_READS,
  type TokenRead,
} from '@/main/accounts/accountSessions'
import {
  createAccountTickets,
  TICKET_OUTCOMES,
  ACCOUNT_TICKET_RENEW_MS,
} from '@/main/servers/accountTickets'
import { CALL_NAMES, type AllowedCall } from '@/main/servers/allowlist'
import type { ServerCallResult } from '@/main/servers/serverCalls'

const SERVER_ID = '00000000-0000-4000-8000-000000000001'
const OTHER_ID = '00000000-0000-4000-8000-000000000002'

const minted = ({ count }: { count: number }): ServerCallResult => ({
  ok: true,
  status: 200,
  body: JSON.stringify({ ticket: `account.t${count}`, expiresAt: 1 }),
})

const setup = ({
  answer = minted,
  token = { kind: TOKEN_READS.token, token: 'jwt' },
}: {
  answer?: (input: { count: number }) => ServerCallResult | Promise<ServerCallResult>
  token?: TokenRead
} = {}) => {
  const clock = { now: 1_000_000 }
  const made: { serverId: string; call: AllowedCall }[] = []
  const asked: { serverId: string; minValidityMs?: number }[] = []
  const tickets = createAccountTickets({
    calls: {
      call: async ({ serverId, call }) => {
        made.push({ serverId, call })
        return answer({ count: made.length })
      },
    },
    sessions: {
      accessToken: async (input) => {
        asked.push(input)
        return token
      },
    },
    now: () => clock.now,
  })
  return { tickets, made, asked, clock }
}

const TITLE = { serverId: SERVER_ID, mediaId: 7, isFresh: false } as const

const refusal = ({ status, reason }: { status: number; reason: string }): ServerCallResult => ({
  ok: true,
  status,
  body: JSON.stringify({ reason, message: 'no' }),
})

describe('ticketFor', () => {
  test('mints with getAccountTicket after a token that outlives the ticket', async () => {
    const { tickets, made, asked } = setup()
    expect(await tickets.ticketFor(TITLE)).toEqual({
      kind: TICKET_OUTCOMES.ticket,
      ticket: 'account.t1',
    })
    expect(asked).toEqual([{ serverId: SERVER_ID, minValidityMs: TICKET_MIN_VALIDITY_MS }])
    expect(made).toEqual([
      { serverId: SERVER_ID, call: { name: CALL_NAMES.getAccountTicket, mediaId: 7 } },
    ])
    expect(TICKET_MIN_VALIDITY_MS).toBe(360_000)
  })

  test('reuses the ticket inside the window, by raven player clock', async () => {
    const { tickets, made, clock } = setup()
    await tickets.ticketFor(TITLE)
    clock.now += ACCOUNT_TICKET_RENEW_MS - 1
    expect(await tickets.ticketFor(TITLE)).toEqual({
      kind: TICKET_OUTCOMES.ticket,
      ticket: 'account.t1',
    })
    expect(made.length).toBe(1)
    expect(ACCOUNT_TICKET_RENEW_MS).toBe(240_000)
  })

  test('renews once the window has passed', async () => {
    const { tickets, made, clock } = setup()
    await tickets.ticketFor(TITLE)
    clock.now += ACCOUNT_TICKET_RENEW_MS
    expect(await tickets.ticketFor(TITLE)).toEqual({
      kind: TICKET_OUTCOMES.ticket,
      ticket: 'account.t2',
    })
    expect(made.length).toBe(2)
  })

  test('the window ignores the expiry the server names', async () => {
    const { tickets, made, clock } = setup({
      answer: ({ count }) => ({
        ok: true,
        status: 200,
        body: JSON.stringify({ ticket: `account.t${count}`, expiresAt: 0 }),
      }),
    })
    await tickets.ticketFor(TITLE)
    clock.now += 1000
    await tickets.ticketFor(TITLE)
    expect(made.length).toBe(1)
  })

  test('isFresh mints again inside the window', async () => {
    const { tickets, made } = setup()
    await tickets.ticketFor(TITLE)
    expect(await tickets.ticketFor({ ...TITLE, isFresh: true })).toEqual({
      kind: TICKET_OUTCOMES.ticket,
      ticket: 'account.t2',
    })
    expect(made.length).toBe(2)
    expect(await tickets.ticketFor(TITLE)).toEqual({
      kind: TICKET_OUTCOMES.ticket,
      ticket: 'account.t2',
    })
    expect(made.length).toBe(2)
  })

  test('each title and each server holds its own ticket', async () => {
    const { tickets, made } = setup()
    await tickets.ticketFor(TITLE)
    expect(await tickets.ticketFor({ ...TITLE, mediaId: 8 })).toEqual({
      kind: TICKET_OUTCOMES.ticket,
      ticket: 'account.t2',
    })
    expect(await tickets.ticketFor({ ...TITLE, serverId: OTHER_ID })).toEqual({
      kind: TICKET_OUTCOMES.ticket,
      ticket: 'account.t3',
    })
    expect(made.length).toBe(3)
  })

  test('never more than one mint in flight per title, fresh or not', async () => {
    const held: { release: () => void } = { release: () => undefined }
    const gate = new Promise<void>((resolve) => {
      held.release = resolve
    })
    const { tickets, made } = setup({
      answer: async ({ count }) => {
        await gate
        return minted({ count })
      },
    })
    const all = Promise.all([
      tickets.ticketFor(TITLE),
      tickets.ticketFor(TITLE),
      tickets.ticketFor({ ...TITLE, isFresh: true }),
    ])
    await Promise.resolve()
    held.release()
    expect(await all).toEqual([
      { kind: TICKET_OUTCOMES.ticket, ticket: 'account.t1' },
      { kind: TICKET_OUTCOMES.ticket, ticket: 'account.t1' },
      { kind: TICKET_OUTCOMES.ticket, ticket: 'account.t1' },
    ])
    expect(made.length).toBe(1)
  })

  test('no session is refused as signed out without a call', async () => {
    const { tickets, made } = setup({ token: { kind: TOKEN_READS.none } })
    expect(await tickets.ticketFor(TITLE)).toEqual({
      kind: TICKET_OUTCOMES.refused,
      reason: AUTH_REFUSALS.signedOut,
    })
    expect(made).toEqual([])
  })

  test('an Auth out of reach is unreachable, not signed out, without a call', async () => {
    const { tickets, made } = setup({ token: { kind: TOKEN_READS.unreachable } })
    expect(await tickets.ticketFor(TITLE)).toEqual({ kind: TICKET_OUTCOMES.unreachable })
    expect(made).toEqual([])
  })

  test.each([
    [
      'a 403 revoked',
      refusal({ status: 403, reason: AUTH_REFUSALS.revoked }),
      { kind: TICKET_OUTCOMES.refused, reason: AUTH_REFUSALS.revoked },
    ],
    [
      'a 403 pending',
      refusal({ status: 403, reason: AUTH_REFUSALS.pending }),
      { kind: TICKET_OUTCOMES.refused, reason: AUTH_REFUSALS.pending },
    ],
    [
      'a 401 signed out',
      refusal({ status: 401, reason: AUTH_REFUSALS.signedOut }),
      { kind: TICKET_OUTCOMES.refused, reason: AUTH_REFUSALS.signedOut },
    ],
    [
      'a 401 with no refusal',
      { ok: true, status: 401, body: '' },
      { kind: TICKET_OUTCOMES.refused, reason: AUTH_REFUSALS.signedOut },
    ],
    [
      'a 403 with no refusal',
      { ok: true, status: 403, body: '' },
      { kind: TICKET_OUTCOMES.refused, reason: AUTH_REFUSALS.revoked },
    ],
    ['a 423', { ok: true, status: 423, body: '{}' }, { kind: TICKET_OUTCOMES.locked }],
    ['a 404', { ok: true, status: 404, body: '{}' }, { kind: TICKET_OUTCOMES.gone }],
    [
      'a 503',
      refusal({ status: 503, reason: AUTH_REFUSALS.unavailable }),
      { kind: TICKET_OUTCOMES.unreachable },
    ],
    ['a 500', { ok: true, status: 500, body: '' }, { kind: TICKET_OUTCOMES.unreachable }],
    [
      'a 200 that is not a ticket',
      { ok: true, status: 200, body: '{"ticket":3}' },
      { kind: TICKET_OUTCOMES.unreachable },
    ],
    ['no answer', { ok: false, message: 'could not reach' }, { kind: TICKET_OUTCOMES.unreachable }],
  ] as const)('%s', async (_label, reply, outcome) => {
    const { tickets, made } = setup({ answer: () => reply })
    expect(await tickets.ticketFor(TITLE)).toEqual(outcome)
    await tickets.ticketFor(TITLE)
    expect(made.length).toBe(2)
  })

  test('a call or a token read that throws is unreachable', async () => {
    const throwing = setup({
      answer: () => {
        throw new Error('boom')
      },
    })
    expect(await throwing.tickets.ticketFor(TITLE)).toEqual({ kind: TICKET_OUTCOMES.unreachable })
    const tickets = createAccountTickets({
      calls: { call: () => Promise.resolve(minted({ count: 1 })) },
      sessions: { accessToken: () => Promise.reject(new Error('keychain')) },
      now: () => 0,
    })
    expect(await tickets.ticketFor(TITLE)).toEqual({ kind: TICKET_OUTCOMES.unreachable })
  })
})

describe('forget', () => {
  test("drops the server's tickets, and only its own", async () => {
    const { tickets } = setup()
    await tickets.ticketFor(TITLE)
    await tickets.ticketFor({ ...TITLE, serverId: OTHER_ID })
    tickets.forget(SERVER_ID)
    expect(await tickets.ticketFor(TITLE)).toEqual({
      kind: TICKET_OUTCOMES.ticket,
      ticket: 'account.t3',
    })
    expect(await tickets.ticketFor({ ...TITLE, serverId: OTHER_ID })).toEqual({
      kind: TICKET_OUTCOMES.ticket,
      ticket: 'account.t2',
    })
  })

  test('a mint in flight as the server is forgotten is not kept', async () => {
    const held: { release: () => void } = { release: () => undefined }
    const gate = new Promise<void>((resolve) => {
      held.release = resolve
    })
    const { tickets, made } = setup({
      answer: async ({ count }) => {
        if (count === 1) await gate
        return minted({ count })
      },
    })
    const first = tickets.ticketFor(TITLE)
    await Promise.resolve()
    tickets.forget(SERVER_ID)
    held.release()
    await first
    expect(await tickets.ticketFor(TITLE)).toEqual({
      kind: TICKET_OUTCOMES.ticket,
      ticket: 'account.t2',
    })
    expect(made.length).toBe(2)
  })
})
