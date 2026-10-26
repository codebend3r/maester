import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ACCOUNT_TICKET_SECONDS,
  AUTH_REFUSALS,
  MEDIA_ORIGIN_KINDS,
  MEMBER_STATUSES,
  type MediaOrigin,
  SUBTITLE_SOURCES,
  LOCKED_STATUS,
  isMediaOrigins,
  isMediaTicket,
} from '@raven/core'
import { CONTENT_TYPES, HEADERS } from '@shared/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { ACCOUNT_TICKET_PREFIX } from '@/auth/accountTickets'
import { ROUTE_METHODS, type RouteMethod } from '@/test/app'
import { AUTH_TEST_IDS, authFixture, bearerHeaders } from '@/test/auth'
import {
  CALLER_KINDS,
  LONG_TOKEN_SECONDS,
  ROUTES,
  type Route,
  TOKEN_CARRIERS,
  createEnforcedApp,
  headersFor,
  mintedTicket,
  outcomeOf,
  pathOf,
  pinMoves,
  withTicket,
} from '@/test/enforced'

describe('account tickets on the media paths', () => {
  const PIN = '4004'
  const ORIGINS = [
    { kind: MEDIA_ORIGIN_KINDS.lan, url: 'https://raven.lan.example.test' },
  ] as const satisfies readonly MediaOrigin[]
  const FIRST_BYTES = { [HEADERS.range]: 'bytes=0-99' }
  const PAST_THE_END = { [HEADERS.range]: 'bytes=999999999-' }
  const SUBRIP = ['1', '00:00:00,200 --> 00:00:00,900', 'Wake up, Neo.', ''].join('\n')
  const TICKET_MS = ACCOUNT_TICKET_SECONDS * 1000

  let tickets: Awaited<ReturnType<typeof authFixture>>
  let plane: Awaited<ReturnType<typeof createEnforcedApp>>
  let planeRoot: string
  let sidecar: string
  let pin: ReturnType<typeof pinMoves>

  beforeAll(async () => {
    planeRoot = await mkdtemp(join(tmpdir(), 'raven-enforcement-tickets-'))
    tickets = await authFixture()
    plane = await createEnforcedApp({
      root: planeRoot,
      fixture: tickets,
      libraryPin: PIN,
      mediaOrigins: ORIGINS,
    })
    pin = pinMoves({ enforced: plane, fixture: tickets, pin: PIN })
    await writeFile(join(plane.mediaDir, 'The Matrix (1999).en.srt'), SUBRIP)
    const { subtitles } = await plane.ownerApi.getTracks(plane.ids.video)
    sidecar = subtitles.find(({ source }) => source === SUBTITLE_SOURCES.external)?.id ?? ''
  })

  afterAll(async () => {
    await plane.app.close()
    await rm(planeRoot, { recursive: true, force: true, maxRetries: 5 })
  })

  const member = () =>
    headersFor({ fixture: tickets, caller: CALLER_KINDS.member, via: TOKEN_CARRIERS.bearer })
  const owner = () =>
    headersFor({ fixture: tickets, caller: CALLER_KINDS.owner, via: TOKEN_CARRIERS.bearer })

  type MintProps = {
    route: typeof ROUTES.mediaTicket | typeof ROUTES.accountTicket
    headers: Record<string, string>
  }

  const mint = ({ route, headers }: MintProps) =>
    plane.app.inject({
      method: route.method,
      url: pathOf({ route, params: { id: plane.ids.video } }),
      headers,
    })

  type TicketOfProps = {
    route: typeof ROUTES.mediaTicket | typeof ROUTES.accountTicket
    headers: Record<string, string>
  }

  const ticketOf = ({ route, headers }: TicketOfProps): Promise<string> =>
    mintedTicket({ app: plane.app, route, id: plane.ids.video, headers })

  type RedeemProps = {
    ticket: string
    route?: Route
    params?: Record<string, number | string>
    method?: RouteMethod
    headers?: Record<string, string>
  }

  const redeem = ({
    ticket,
    route = ROUTES.file,
    params = { id: plane.ids.video },
    method = ROUTE_METHODS.get,
    headers = {},
  }: RedeemProps) =>
    plane.app.inject({ method, url: withTicket({ route, params, ticket }), headers })

  type UnlockAsOwnerProps = { headers: Record<string, string> }

  /** The owner's Bearer with the unlock cookie the PIN earns it. */
  const unlockAsOwner = async ({ headers }: UnlockAsOwnerProps) =>
    (await pin.unlock({ headers })).headers

  it('mints with Bearer alone, on the GET as on the POST, a ticket of five minutes at most', async () => {
    const cookieOnly = await headersFor({
      fixture: tickets,
      caller: CALLER_KINDS.member,
      via: TOKEN_CARRIERS.cookie,
    })
    const refusals = await Promise.all(
      [{}, cookieOnly].map(async (headers) =>
        outcomeOf({ response: await mint({ route: ROUTES.mediaTicket, headers }) }),
      ),
    )
    expect(refusals.map(({ status, reason }) => ({ status, reason }))).toEqual([
      { status: 401, reason: AUTH_REFUSALS.signedOut },
      { status: 401, reason: AUTH_REFUSALS.signedOut },
    ])
    const headers = await member()
    const minted = await Promise.all(
      [ROUTES.mediaTicket, ROUTES.accountTicket].map(async (route) => {
        const response = await mint({ route, headers })
        const body: unknown = response.json()
        return { status: response.statusCode, ticket: isMediaTicket(body) ? body : null }
      }),
    )
    minted.forEach(({ status, ticket }) => {
      expect(status).toBe(200)
      expect(ticket?.ticket.startsWith(ACCOUNT_TICKET_PREFIX) ?? false).toBe(true)
      expect(ticket?.expiresAt ?? Infinity).toBeLessThanOrEqual(Date.now() + TICKET_MS)
    })
  })

  it('plays a range, an unsatisfiable range, a HEAD and a sidecar with the ticket alone', async () => {
    const ticket = await ticketOf({ route: ROUTES.mediaTicket, headers: await member() })
    const ranged = await redeem({ ticket, headers: FIRST_BYTES })
    expect(ranged.statusCode).toBe(206)
    expect(ranged.headers[HEADERS.contentRange]).toMatch(/^bytes 0-99\//)
    expect((await redeem({ ticket, headers: PAST_THE_END })).statusCode).toBe(416)
    expect((await redeem({ ticket, method: ROUTE_METHODS.head })).statusCode).toBe(200)
    const subtitles = await redeem({
      ticket,
      route: ROUTES.subtitles,
      params: { id: plane.ids.video, trackId: sidecar },
    })
    expect(subtitles.statusCode).toBe(200)
    expect(subtitles.headers[HEADERS.contentType]).toBe(CONTENT_TYPES.vtt)
  })

  it('signs out an expired ticket and one for another video, and a new mint plays again', async () => {
    const headers = await member()
    const ticket = await ticketOf({ route: ROUTES.accountTicket, headers })
    const elsewhere = await redeem({ ticket, params: { id: plane.ids.video + 1 } })
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(Date.now() + TICKET_MS + 1_000)
      const expired = await redeem({ ticket, headers: FIRST_BYTES })
      expect(
        [elsewhere, expired].map((response) => {
          const { status, reason } = outcomeOf({ response })
          return { status, reason }
        }),
      ).toEqual([
        { status: 401, reason: AUTH_REFUSALS.signedOut },
        { status: 401, reason: AUTH_REFUSALS.signedOut },
      ])
      const renewed = await ticketOf({ route: ROUTES.accountTicket, headers })
      expect((await redeem({ ticket: renewed, headers: FIRST_BYTES })).statusCode).toBe(206)
    } finally {
      vi.useRealTimers()
    }
  })

  it('shuts a ticket at once when its library is locked after the mint', async () => {
    const ticket = await ticketOf({ route: ROUTES.accountTicket, headers: await member() })
    expect((await redeem({ ticket, headers: FIRST_BYTES })).statusCode).toBe(206)
    await pin.setLocked({ isLocked: true })
    try {
      expect((await redeem({ ticket, headers: FIRST_BYTES })).statusCode).toBe(404)
    } finally {
      await pin.setLocked({ isLocked: false })
    }
  })

  it("carries the owner's PIN into a ticket minted with it, and into no other", async () => {
    const headers = await owner()
    const before = await ticketOf({ route: ROUTES.accountTicket, headers })
    await pin.setLocked({ isLocked: true })
    try {
      expect((await redeem({ ticket: before, headers: FIRST_BYTES })).statusCode).toBe(
        LOCKED_STATUS,
      )
      const unlocked = await ticketOf({
        route: ROUTES.accountTicket,
        headers: await unlockAsOwner({ headers }),
      })
      expect((await redeem({ ticket: unlocked, headers: FIRST_BYTES })).statusCode).toBe(206)
    } finally {
      await pin.setLocked({ isLocked: false })
    }
  })

  it("ends a ticket's pass on a locked library as the owner locks again, and takes back every live ticket's unlock", async () => {
    await pin.setLocked({ isLocked: true })
    try {
      const unlocked = await unlockAsOwner({ headers: await owner() })
      const played = await ticketOf({ route: ROUTES.accountTicket, headers: unlocked })
      const unplayed = await ticketOf({ route: ROUTES.accountTicket, headers: unlocked })
      expect((await redeem({ ticket: played, headers: FIRST_BYTES })).statusCode).toBe(206)
      await pin.relock({ headers: unlocked })
      expect(
        await Promise.all(
          [played, unplayed].map(
            async (ticket) => (await redeem({ ticket, headers: FIRST_BYTES })).statusCode,
          ),
        ),
      ).toEqual([LOCKED_STATUS, LOCKED_STATUS])
      vi.useFakeTimers({ toFake: ['Date'] })
      try {
        vi.setSystemTime(Date.now() + TICKET_MS + 1_000)
        expect(
          outcomeOf({ response: await redeem({ ticket: played, headers: FIRST_BYTES }) }),
        ).toMatchObject({ status: 401, reason: AUTH_REFUSALS.signedOut })
        // The player opens the video again, and its new ticket meets the lock.
        const reopened = await mint({ route: ROUTES.accountTicket, headers: await owner() })
        expect(reopened.statusCode).toBe(LOCKED_STATUS)
      } finally {
        vi.useRealTimers()
      }
    } finally {
      await pin.setLocked({ isLocked: false })
    }
  })

  it("keeps a ticket's pass on an unlocked library through a relock, without the unlock", async () => {
    const unlocked = await unlockAsOwner({ headers: await owner() })
    const ticket = await ticketOf({ route: ROUTES.accountTicket, headers: unlocked })
    expect((await redeem({ ticket, headers: FIRST_BYTES })).statusCode).toBe(206)
    await pin.relock({ headers: unlocked })
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(Date.now() + TICKET_MS + 1_000)
      expect((await redeem({ ticket, headers: FIRST_BYTES })).statusCode).toBe(206)
      await pin.setLocked({ isLocked: true })
      try {
        expect((await redeem({ ticket, headers: FIRST_BYTES })).statusCode).toBe(LOCKED_STATUS)
      } finally {
        await pin.setLocked({ isLocked: false })
      }
    } finally {
      vi.useRealTimers()
    }
  })

  it("ends a ticket's pass on a locked library as the owner's unlock lapses", async () => {
    await pin.setLocked({ isLocked: true })
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const start = Date.now()
      const longOwner = bearerHeaders({
        token: await tickets.mint({ id: AUTH_TEST_IDS.owner, expiresIn: LONG_TOKEN_SECONDS }),
      })
      const { headers: unlocked, lapsesAt } = await pin.unlock({ headers: longOwner })
      // Opened a minute after the unlock, so the pass's deadline falls after the unlock lapses.
      vi.setSystemTime(start + 60_000)
      const ticket = await ticketOf({ route: ROUTES.accountTicket, headers: unlocked })
      expect((await redeem({ ticket, headers: FIRST_BYTES })).statusCode).toBe(206)
      vi.setSystemTime(lapsesAt - 1)
      expect((await redeem({ ticket, headers: FIRST_BYTES })).statusCode).toBe(206)
      vi.setSystemTime(lapsesAt)
      expect(outcomeOf({ response: await redeem({ ticket, headers: FIRST_BYTES }) })).toMatchObject(
        { status: 401, reason: AUTH_REFUSALS.signedOut },
      )
    } finally {
      vi.useRealTimers()
      await pin.setLocked({ isLocked: false })
    }
  })

  it('refuses the next range once the owner removes the account', async () => {
    const ticket = await ticketOf({ route: ROUTES.accountTicket, headers: await member() })
    expect((await redeem({ ticket, headers: FIRST_BYTES })).statusCode).toBe(206)
    await plane.ownerApi.setMemberStatus({
      id: AUTH_TEST_IDS.friend,
      change: { status: MEMBER_STATUSES.revoked },
    })
    try {
      expect(outcomeOf({ response: await redeem({ ticket, headers: FIRST_BYTES }) })).toMatchObject(
        { status: 403, reason: AUTH_REFUSALS.revoked },
      )
    } finally {
      await plane.ownerApi.setMemberStatus({
        id: AUTH_TEST_IDS.friend,
        change: { status: MEMBER_STATUSES.approved },
      })
    }
  })

  it('offers the media origins with no media secret set', async () => {
    const body: unknown = (
      await plane.app.inject({ url: ROUTES.mediaOrigins.path, headers: await member() })
    ).json()
    expect(isMediaOrigins(body) ? body.origins : null).toEqual(ORIGINS)
  })
})
