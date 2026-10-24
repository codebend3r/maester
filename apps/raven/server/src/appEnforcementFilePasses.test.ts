import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Logger } from '@nestjs/common'
import {
  ACCOUNT_TICKET_SECONDS,
  AUTH_REFUSALS,
  HLS_PARAMS,
  MEDIA_TICKET_PARAM,
  MEMBER_STATUSES,
  PLAYBACK_MODES,
  SUBTITLE_SOURCES,
  toQueryString,
} from '@raven/core'
import { HEADERS } from '@shared/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { ACCOUNT_PASS_MS } from '@/auth/accountPasses'
import { MEMBERSHIP_TTL_MS } from '@/auth/membershipLookups'
import { ROUTE_METHODS, type RouteMethod, eventually } from '@/test/app'
import { AUTH_TEST_FAILURES, AUTH_TEST_IDS, authFixture, bearerHeaders } from '@/test/auth'
import {
  CALLER_KINDS,
  type CallerKind,
  LONG_TOKEN_SECONDS,
  ROUTES,
  TOKEN_CARRIERS,
  addLeftovers,
  createEnforcedApp,
  headersFor,
  mintedTicket,
  outcomeOf,
  pathOf,
  withTicket,
} from '@/test/enforced'

describe("an account ticket's pass on the file it opened", () => {
  const RECHECK_MS = 100
  const TICKET_MS = ACCOUNT_TICKET_SECONDS * 1000
  /** Past the ticket's five minutes, well inside any token minted here. */
  const PAST_TICKET_MS = TICKET_MS + 1_000
  /** Several rechecks long, and the bound a test holds the server to. */
  const ENDED_WITHIN_MS = 1_000
  const FIRST_BYTES = { [HEADERS.range]: 'bytes=0-99' }
  const LATER_BYTES = { [HEADERS.range]: 'bytes=100-199' }
  const SUBRIP = ['1', '00:00:00,200 --> 00:00:00,900', 'Wake up, Neo.', ''].join('\n')
  const SIGNED_OUT = { status: 401, reason: AUTH_REFUSALS.signedOut } as const
  const LOG_METHODS = ['log', 'warn', 'error', 'debug', 'verbose', 'fatal'] as const
  const CONSOLE_METHODS = ['log', 'info', 'warn', 'error', 'debug'] as const
  /** What `statusOf` gives a response cut short: a player asks such a one again by range. */
  const CUT = 0
  /** How the faked clock runs: held where a test sets it, or on from there with real time. */
  const CLOCKS = { held: 'held', running: 'running' } as const

  let fixture: Awaited<ReturnType<typeof authFixture>>
  let plane: Awaited<ReturnType<typeof createEnforcedApp>>
  let root: string
  let other: number
  let sidecar: string

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'raven-enforcement-file-passes-'))
    fixture = await authFixture()
    plane = await createEnforcedApp({ root, fixture, accessRecheckMs: RECHECK_MS })
    other = (await addLeftovers({ enforced: plane })).duplicate
    await writeFile(join(plane.mediaDir, 'The Matrix (1999).en.srt'), SUBRIP)
    const { subtitles } = await plane.ownerApi.getTracks(plane.ids.video)
    sidecar = subtitles.find(({ source }) => source === SUBTITLE_SOURCES.external)?.id ?? ''
  })

  afterAll(async () => {
    await plane.app.close()
    await rm(root, { recursive: true, force: true, maxRetries: 5 })
  })

  /** An account ticket for `id`, minted by `caller` with Bearer, or with `headers` when given. */
  const ticketFor = async ({
    caller = CALLER_KINDS.member,
    id = plane.ids.video,
    headers,
  }: {
    caller?: CallerKind
    id?: number
    headers?: Record<string, string>
  } = {}): Promise<string> =>
    mintedTicket({
      app: plane.app,
      id,
      headers: headers ?? (await headersFor({ fixture, caller, via: TOKEN_CARRIERS.bearer })),
    })

  /** Asks for `id`'s file with `ticket` alone, as a native player's range request does. */
  const play = ({
    ticket,
    id = plane.ids.video,
    headers = FIRST_BYTES,
    method = ROUTE_METHODS.get,
  }: {
    ticket: string
    id?: number
    headers?: Record<string, string>
    method?: RouteMethod
  }) =>
    plane.app.inject({
      method,
      url: withTicket({ route: ROUTES.file, params: { id }, ticket }),
      headers,
    })

  /** The status a request was answered with, or `CUT` when a recheck cut its response mid-way. */
  const statusOf = (response: ReturnType<typeof play>): Promise<number> =>
    response.then(
      ({ statusCode }) => statusCode,
      () => CUT,
    )

  const refusalOf = async (response: ReturnType<typeof play>) => {
    const { status, reason } = outcomeOf({ response: await response })
    return { status, reason }
  }

  /** Runs `work` on a faked clock, from `start`, the real time it was faked at. */
  const onFakedClock = async ({
    clock,
    work,
  }: {
    clock: (typeof CLOCKS)[keyof typeof CLOCKS]
    work: (start: number) => Promise<void>
  }): Promise<void> => {
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: clock === CLOCKS.running })
    try {
      await work(Date.now())
    } finally {
      vi.useRealTimers()
    }
  }

  const setStatus = ({
    id,
    status,
  }: {
    id: string
    status: typeof MEMBER_STATUSES.approved | typeof MEMBER_STATUSES.revoked
  }) => plane.ownerApi.setMemberStatus({ id, change: { status } })

  it('opens its file by range past its five minutes once it has opened it', async () => {
    const ticket = await ticketFor()
    expect((await play({ ticket })).statusCode).toBe(206)
    await onFakedClock({
      clock: CLOCKS.held,
      work: async (start) => {
        vi.setSystemTime(start + PAST_TICKET_MS)
        const first = await play({ ticket })
        const later = await play({ ticket, headers: LATER_BYTES })
        const head = await play({ ticket, headers: {}, method: ROUTE_METHODS.head })
        expect([first, later, head].map(({ statusCode }) => statusCode)).toEqual([206, 206, 200])
        expect(later.headers[HEADERS.contentRange]).toMatch(/^bytes 100-199\//)
      },
    })
  })

  it('opens nothing of another media past its five minutes, and no route but its file', async () => {
    const ticket = await ticketFor()
    expect((await play({ ticket })).statusCode).toBe(206)
    const params = { id: plane.ids.video, trackId: sidecar }
    const master = `${pathOf({ route: ROUTES.hlsMaster, params })}?${toQueryString({
      [HLS_PARAMS.mode]: PLAYBACK_MODES.remux,
      [MEDIA_TICKET_PARAM]: ticket,
    })}`
    const elsewhere = [
      master,
      ...[ROUTES.subtitles, ROUTES.stream, ROUTES.tracks].map((route) =>
        withTicket({ route, params, ticket }),
      ),
    ]
    const subtitles = withTicket({ route: ROUTES.subtitles, params, ticket })
    expect((await plane.app.inject({ url: subtitles })).statusCode).toBe(200)
    await onFakedClock({
      clock: CLOCKS.held,
      work: async (start) => {
        vi.setSystemTime(start + PAST_TICKET_MS)
        const refused = await Promise.all([
          refusalOf(play({ ticket, id: other })),
          ...elsewhere.map((url) => refusalOf(plane.app.inject({ url }))),
        ])
        expect(refused).toEqual(refused.map(() => SIGNED_OUT))
        expect((await play({ ticket })).statusCode).toBe(206)
      },
    })
  })

  it('signs out an expired ticket that never opened its file, whatever else it opened', async () => {
    const ticket = await ticketFor()
    const params = { id: plane.ids.video, trackId: sidecar }
    const subtitles = withTicket({ route: ROUTES.subtitles, params, ticket })
    expect((await plane.app.inject({ url: subtitles })).statusCode).toBe(200)
    expect(await refusalOf(play({ ticket, id: other }))).toEqual(SIGNED_OUT)
    await onFakedClock({
      clock: CLOCKS.held,
      work: async (start) => {
        vi.setSystemTime(start + PAST_TICKET_MS)
        expect(await refusalOf(play({ ticket }))).toEqual(SIGNED_OUT)
      },
    })
  })

  it('ends twelve hours after it first opened its file, however busy it kept', async () => {
    await onFakedClock({
      clock: CLOCKS.held,
      work: async (start) => {
        const headers = bearerHeaders({
          token: await fixture.mint({ id: AUTH_TEST_IDS.friend, expiresIn: LONG_TOKEN_SECONDS }),
        })
        const ticket = await ticketFor({ headers })
        // Opened a minute after the mint: the twelve hours run from the open.
        const opened = start + 60_000
        vi.setSystemTime(opened)
        expect((await play({ ticket })).statusCode).toBe(206)
        vi.setSystemTime(opened + ACCOUNT_PASS_MS / 2)
        expect((await play({ ticket, headers: LATER_BYTES })).statusCode).toBe(206)
        vi.setSystemTime(opened + ACCOUNT_PASS_MS - 1)
        expect((await play({ ticket })).statusCode).toBe(206)
        vi.setSystemTime(opened + ACCOUNT_PASS_MS)
        expect(await refusalOf(play({ ticket }))).toEqual(SIGNED_OUT)
        vi.setSystemTime(opened + ACCOUNT_PASS_MS - 1)
        expect(await refusalOf(play({ ticket }))).toEqual(SIGNED_OUT)
      },
    })
  })

  it("ends within a recheck of its account's removal, and a new ticket opens again", async () => {
    const ticket = await ticketFor()
    expect((await play({ ticket })).statusCode).toBe(206)
    await onFakedClock({
      clock: CLOCKS.running,
      work: async (start) => {
        vi.setSystemTime(start + PAST_TICKET_MS)
        expect((await play({ ticket })).statusCode).toBe(206)
        await setStatus({ id: AUTH_TEST_IDS.friend, status: MEMBER_STATUSES.revoked })
        try {
          const started = performance.now()
          await eventually({
            read: () => statusOf(play({ ticket })),
            check: (status) => status === 401,
            ms: ENDED_WITHIN_MS,
          })
          expect(performance.now() - started).toBeLessThan(ENDED_WITHIN_MS)
        } finally {
          await setStatus({ id: AUTH_TEST_IDS.friend, status: MEMBER_STATUSES.approved })
        }
        expect(await refusalOf(play({ ticket }))).toEqual(SIGNED_OUT)
        expect((await play({ ticket: await ticketFor() })).statusCode).toBe(206)
      },
    })
  })

  it('ends within a recheck of a failed integrity check', async () => {
    const ticket = await ticketFor()
    expect((await play({ ticket })).statusCode).toBe(206)
    await onFakedClock({
      clock: CLOCKS.running,
      work: async (start) => {
        vi.setSystemTime(start + PAST_TICKET_MS)
        expect((await play({ ticket })).statusCode).toBe(206)
        fixture.state.failure = AUTH_TEST_FAILURES.wrongAccount
        try {
          // The member's last answer is reused for its TTL before a recheck asks again.
          await eventually({
            read: () => statusOf(play({ ticket })),
            check: (status) => status === 401,
            ms: MEMBERSHIP_TTL_MS + ENDED_WITHIN_MS,
          })
        } finally {
          fixture.state.failure = AUTH_TEST_FAILURES.none
        }
        expect(await refusalOf(play({ ticket }))).toEqual(SIGNED_OUT)
      },
    })
  })

  it('keeps its file open through an outage inside its five minutes too, which an unbound ticket is refused in', async () => {
    const bound = await ticketFor()
    const unbound = await ticketFor()
    expect((await play({ ticket: bound })).statusCode).toBe(206)
    await onFakedClock({
      clock: CLOCKS.held,
      work: async (start) => {
        // Past the answers held for the tokens, so each request asks the outage again.
        vi.setSystemTime(start + MEMBERSHIP_TTL_MS + 1)
        fixture.state.failure = AUTH_TEST_FAILURES.network
        try {
          expect((await play({ ticket: bound })).statusCode).toBe(206)
          expect(await refusalOf(play({ ticket: unbound }))).toEqual({
            status: 503,
            reason: AUTH_REFUSALS.unavailable,
          })
        } finally {
          fixture.state.failure = AUTH_TEST_FAILURES.none
        }
      },
    })
  })

  it('keeps playing through an outage, and puts the ticket in no log line', async () => {
    const logged = LOG_METHODS.map((method) =>
      vi.spyOn(Logger.prototype, method).mockImplementation(() => undefined),
    )
    const printed = CONSOLE_METHODS.map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    )
    const lines = () =>
      JSON.stringify([...logged, ...printed].flatMap((spy) => spy.mock.calls.flat().map(String)))
    try {
      const ticket = await ticketFor({ caller: CALLER_KINDS.guest })
      expect((await play({ ticket })).statusCode).toBe(206)
      await onFakedClock({
        clock: CLOCKS.running,
        work: async (start) => {
          vi.setSystemTime(start + PAST_TICKET_MS)
          expect((await play({ ticket })).statusCode).toBe(206)
          expect(await refusalOf(play({ ticket, id: other }))).toEqual(SIGNED_OUT)
          // An outage makes the pass's recheck warn, and keeps it.
          fixture.state.failure = AUTH_TEST_FAILURES.network
          try {
            await eventually({
              read: async () => lines(),
              check: (text) => text.includes('keeping it'),
            })
            expect((await play({ ticket })).statusCode).toBe(206)
          } finally {
            fixture.state.failure = AUTH_TEST_FAILURES.none
          }
          await setStatus({ id: AUTH_TEST_IDS.guest, status: MEMBER_STATUSES.revoked })
          try {
            await eventually({
              read: () => statusOf(play({ ticket })),
              check: (status) => status === 401,
              ms: ENDED_WITHIN_MS,
            })
          } finally {
            await setStatus({ id: AUTH_TEST_IDS.guest, status: MEMBER_STATUSES.approved })
          }
        },
      })
      expect(lines()).toContain('keeping it')
      expect(lines()).not.toContain(ticket)
      expect(lines()).not.toContain(ticket.slice(-16))
    } finally {
      ;[...logged, ...printed].forEach((spy) => spy.mockRestore())
    }
  })
})
