import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Logger } from '@nestjs/common'
import {
  AUTH_HEADERS,
  AUTH_REFUSALS,
  HLS_PARAMS,
  HLS_PATHS,
  LIBRARY_KINDS,
  LOCKED_STATUS,
  MEDIA_TICKET_PARAM,
  MEMBER_STATUSES,
  PLAYBACK_MODES,
  SUBTITLE_SOURCES,
  isMediaTicket,
  toQueryString,
} from '@raven/core'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { ACCOUNT_PASS_MS } from '@/auth/accountPasses'
import { MEMBERSHIP_TTL_MS } from '@/auth/membershipLookups'
import { HLS_CAPABILITY_PREFIX } from '@/hls/hlsCapability'
import { cookieSet, eventually, routePath } from '@/test/app'
import { AUTH_TEST_FAILURES, AUTH_TEST_IDS, authFixture, bearerHeaders } from '@/test/auth'
import {
  CALLER_KINDS,
  type CallerKind,
  ROUTES,
  TOKEN_CARRIERS,
  addLeftovers,
  createEnforcedApp,
  headersFor,
  hlsSessionIn,
  outcomeOf,
  pathOf,
  withTicket,
} from '@/test/enforced'

describe("an account's HLS session", () => {
  const RECHECK_MS = 100
  const PIN = '7007'
  /** Two days: a token that outlives every jump of the clock here, so no recheck ends a session for it. */
  const LONG_TOKEN_SECONDS = 2 * 24 * 60 * 60
  /** `?t=` given twice, which Fastify reads as an array. */
  const REPEATED = `${MEDIA_TICKET_PARAM}=a&${MEDIA_TICKET_PARAM}=b`
  /** Several rechecks long, and the bound a test holds the server to. */
  const ENDED_WITHIN_MS = 1_000
  const SUBRIP = ['1', '00:00:00,200 --> 00:00:00,900', 'Wake up, Neo.', ''].join('\n')
  /** Any URL base, to read a URI's path and query with `URL`. */
  const BASE = 'http://raven.test'
  const LOG_METHODS = ['log', 'warn', 'error', 'debug', 'verbose', 'fatal'] as const
  const CONSOLE_METHODS = ['log', 'info', 'warn', 'error', 'debug'] as const

  let fixture: Awaited<ReturnType<typeof authFixture>>
  let plane: Awaited<ReturnType<typeof createEnforcedApp>>
  let root: string
  /** Each video's sidecar track, by media id. */
  const sidecars = new Map<number, string>()
  let other: number

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'raven-enforcement-hls-'))
    fixture = await authFixture()
    plane = await createEnforcedApp({
      root,
      fixture,
      libraryPin: PIN,
      accessRecheckMs: RECHECK_MS,
    })
    other = (await addLeftovers({ enforced: plane })).duplicate
    await Promise.all(
      ['The Matrix (1999).en.srt', 'The Matrix (1999) Final Cut.en.srt'].map((name) =>
        writeFile(join(plane.mediaDir, name), SUBRIP),
      ),
    )
    await Promise.all(
      [plane.ids.video, other].map(async (id) => {
        const { subtitles } = await plane.ownerApi.getTracks(id)
        const track = subtitles.find(({ source }) => source === SUBTITLE_SOURCES.external)
        sidecars.set(id, track?.id ?? '')
      }),
    )
  })

  afterAll(async () => {
    await plane.app.close()
    await rm(root, { recursive: true, force: true, maxRetries: 5 })
  })

  const get = ({ url, headers = {} }: { url: string; headers?: Record<string, string> }) =>
    plane.app.inject({ url, headers })

  const bearerOf = (caller: CallerKind) =>
    headersFor({ fixture, caller, via: TOKEN_CARRIERS.bearer })

  /** An account ticket for `id`, minted by `caller` with Bearer, or with `headers` when given. */
  const ticketFor = async ({
    caller,
    id,
    headers,
  }: {
    caller: CallerKind
    id: number
    headers?: Record<string, string>
  }) => {
    const response = await plane.app.inject({
      method: ROUTES.accountTicket.method,
      url: pathOf({ route: ROUTES.accountTicket, params: { id } }),
      headers: headers ?? (await bearerOf(caller)),
    })
    const body: unknown = response.json()
    if (!isMediaTicket(body)) throw new Error('No ticket was minted')
    return body.ticket
  }

  /** The URIs a playlist names on lines of their own: a master's variant, a media playlist's segments. */
  const linesIn = (playlist: string): string[] =>
    playlist.split('\n').filter((line) => line.trim() !== '' && !line.startsWith('#'))

  /** The URIs a playlist's tags name: a master's renditions, a media playlist's init. */
  const attributesIn = (playlist: string): string[] =>
    [...playlist.matchAll(/URI="([^"]+)"/g)].flatMap((match) => match[1] ?? [])

  const urisIn = (playlist: string): string[] => [...linesIn(playlist), ...attributesIn(playlist)]

  const keyOf = (uri: string): string | null =>
    new URL(uri, BASE).searchParams.get(MEDIA_TICKET_PARAM)

  type Opened = {
    id: number
    session: string
    ticket: string
    capability: string
    /** Every URI the master, video and subtitle playlists named. */
    named: string[]
  }

  /** Opens a remux of `id` with an account ticket alone, as a native player does. */
  const open = async ({
    caller,
    id,
    headers,
  }: {
    caller: CallerKind
    id: number
    /** What the ticket is minted with, when not the caller's Bearer alone. */
    headers?: Record<string, string>
  }): Promise<Opened> => {
    const ticket = await ticketFor({ caller, id, headers })
    const query = toQueryString({
      [HLS_PARAMS.mode]: PLAYBACK_MODES.remux,
      [MEDIA_TICKET_PARAM]: ticket,
    })
    const master = await get({
      url: `${pathOf({ route: ROUTES.hlsMaster, params: { id } })}?${query}`,
    })
    expect(master.statusCode).toBe(200)
    const [variant = ''] = linesIn(master.body)
    const subtitles = attributesIn(master.body)
    const playlists = await Promise.all([variant, ...subtitles].map((url) => get({ url })))
    playlists.forEach((response) => expect(response.statusCode).toBe(200))
    const named = [
      ...urisIn(master.body),
      ...playlists.flatMap((response) => urisIn(response.body)),
    ]
    return {
      id,
      session: hlsSessionIn(variant),
      ticket,
      capability: keyOf(variant) ?? '',
      named,
    }
  }

  /** The five routes a session's capability opens, for `session` of media `id`, carrying `key`. */
  const sessionRoutes = ({
    id,
    session,
    key,
  }: {
    id: number
    session: string
    key: string | null
  }): string[] =>
    [
      HLS_PATHS.video,
      HLS_PATHS.init,
      HLS_PATHS.segment,
      HLS_PATHS.subtitles,
      HLS_PATHS.subtitleSegment,
    ]
      .map((route) =>
        routePath({
          route,
          values: {
            [HLS_PARAMS.id]: id,
            [HLS_PARAMS.session]: session,
            [HLS_PARAMS.trackId]: sidecars.get(id) ?? '',
            [HLS_PARAMS.n]: 0,
          },
        }),
      )
      .map((path) =>
        key === null ? path : `${path}?${toQueryString({ [MEDIA_TICKET_PARAM]: key })}`,
      )

  const statusesOf = async ({
    urls,
    headers,
  }: {
    urls: string[]
    headers?: Record<string, string>
  }): Promise<number[]> =>
    Promise.all(urls.map(async (url) => (await get({ url, headers })).statusCode))

  /** The owner's Bearer with the unlock cookie the PIN earns, and when that unlock lapses. */
  const unlockAsOwner = async ({ headers }: { headers: Record<string, string> }) => {
    const unlocking = await plane.app.inject({
      method: ROUTES.unlock.method,
      url: ROUTES.unlock.path,
      headers,
      payload: { pin: PIN },
    })
    expect(unlocking.statusCode).toBe(200)
    const cookie = cookieSet(unlocking)
    const [, value = ''] = cookie.split('=')
    const [expires = ''] = value.split('.')
    return { headers: { ...headers, [AUTH_HEADERS.cookie]: cookie }, lapsesAt: Number(expires) }
  }

  /** Locks or opens the library as the owner, past the PIN, as a locked library's settings are changed. */
  const setLocked = async ({ isLocked }: { isLocked: boolean }) => {
    const { headers } = await unlockAsOwner({ headers: await bearerOf(CALLER_KINDS.owner) })
    const response = await plane.app.inject({
      method: ROUTES.updateLibrary.method,
      url: pathOf({ route: ROUTES.updateLibrary, params: { id: plane.ids.library } }),
      headers,
      payload: {
        name: 'Enforced',
        paths: [plane.mediaDir],
        settings: { kind: LIBRARY_KINDS.movies, locked: isLocked },
      },
    })
    expect(response.statusCode).toBe(200)
  }

  /** The status and refusal of each response, for the routes that answer an auth refusal. */
  const refusalsOf = async ({
    urls,
    headers,
  }: {
    urls: string[]
    headers?: Record<string, string>
  }) =>
    Promise.all(
      urls.map(async (url) => {
        const { status, reason } = outcomeOf({ response: await get({ url, headers }) })
        return { status, reason }
      }),
    )

  const SIGNED_OUT = { status: 401, reason: AUTH_REFUSALS.signedOut } as const

  const setStatus = ({
    id,
    status,
  }: {
    id: string
    status: typeof MEMBER_STATUSES.approved | typeof MEMBER_STATUSES.revoked
  }) => plane.ownerApi.setMemberStatus({ id, change: { status } })

  // These move the clock ahead and back first, so a membership answer cached while it was ahead
  // must never hide what the tests after them check.
  it("carries the owner's PIN unlock into the session, and answers 423 once it lapses", async () => {
    await setLocked({ isLocked: true })
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const start = Date.now()
      const owner = bearerHeaders({
        token: await fixture.mint({ id: AUTH_TEST_IDS.owner, expiresIn: LONG_TOKEN_SECONDS }),
      })
      const { headers, lapsesAt } = await unlockAsOwner({ headers: owner })
      // Opened a minute after the unlock, so the capability's deadline falls after the unlock lapses.
      vi.setSystemTime(start + 60_000)
      const opened = await open({ caller: CALLER_KINDS.owner, id: plane.ids.video, headers })
      const urls = sessionRoutes({ id: opened.id, session: opened.session, key: opened.capability })
      expect(await statusesOf({ urls })).toEqual([200, 200, 200, 200, 200])
      vi.setSystemTime(lapsesAt)
      expect(await statusesOf({ urls })).toEqual(urls.map(() => LOCKED_STATUS))
    } finally {
      vi.useRealTimers()
      await setLocked({ isLocked: false })
    }
  })

  it('ends the session at its capability deadline, however busy it kept', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const start = Date.now()
      const member = bearerHeaders({
        token: await fixture.mint({ id: AUTH_TEST_IDS.friend, expiresIn: LONG_TOKEN_SECONDS }),
      })
      const opened = await open({
        caller: CALLER_KINDS.member,
        id: plane.ids.video,
        headers: member,
      })
      const urls = sessionRoutes({ id: opened.id, session: opened.session, key: opened.capability })
      vi.setSystemTime(start + ACCOUNT_PASS_MS - 1)
      expect(await statusesOf({ urls })).toEqual([200, 200, 200, 200, 200])
      vi.setSystemTime(start + ACCOUNT_PASS_MS)
      expect(await statusesOf({ urls })).toEqual([404, 404, 404, 404, 404])
    } finally {
      vi.useRealTimers()
    }
  })

  it('names its own capability on every URI, never the ticket, and plays on it alone', async () => {
    const first = await open({ caller: CALLER_KINDS.member, id: plane.ids.video })
    const second = await open({ caller: CALLER_KINDS.member, id: plane.ids.video })
    expect(first.capability.startsWith(HLS_CAPABILITY_PREFIX)).toBe(true)
    expect(first.capability).not.toBe(second.capability)
    expect(first.named.length).toBeGreaterThan(3)
    expect(first.named.map(keyOf)).toEqual(first.named.map(() => first.capability))
    expect(first.named.join('\n')).not.toContain(first.ticket)
    expect(
      await statusesOf({
        urls: sessionRoutes({ id: first.id, session: first.session, key: first.capability }),
      }),
    ).toEqual([200, 200, 200, 200, 200])
  })

  it("opens nothing of another account's session or another media with it", async () => {
    const mine = await open({ caller: CALLER_KINDS.member, id: plane.ids.video })
    const theirs = await open({ caller: CALLER_KINDS.guest, id: other })
    const forged = `${HLS_CAPABILITY_PREFIX}${'A'.repeat(43)}`
    const refused = await Promise.all(
      [
        sessionRoutes({ id: theirs.id, session: theirs.session, key: mine.capability }),
        sessionRoutes({ id: mine.id, session: mine.session, key: theirs.capability }),
        sessionRoutes({ id: other, session: mine.session, key: mine.capability }),
        sessionRoutes({ id: mine.id, session: mine.session, key: forged }),
      ].map((urls) => statusesOf({ urls })),
    )
    expect(refused).toEqual(refused.map(() => [404, 404, 404, 404, 404]))
    expect(
      await statusesOf({
        urls: sessionRoutes({ id: theirs.id, session: theirs.session, key: theirs.capability }),
      }),
    ).toEqual([200, 200, 200, 200, 200])
  })

  it('refuses an account ticket, a Bearer or the cookie on its routes once it has a capability', async () => {
    const opened = await open({ caller: CALLER_KINDS.member, id: plane.ids.video })
    const ticket = await ticketFor({ caller: CALLER_KINDS.member, id: plane.ids.video })
    const bare = sessionRoutes({ id: opened.id, session: opened.session, key: null })
    const byTicket = await statusesOf({
      urls: sessionRoutes({ id: opened.id, session: opened.session, key: ticket }),
    })
    const byBearer = await statusesOf({ urls: bare, headers: await bearerOf(CALLER_KINDS.member) })
    const byCookie = await statusesOf({
      urls: bare,
      headers: await headersFor({
        fixture,
        caller: CALLER_KINDS.member,
        via: TOKEN_CARRIERS.cookie,
      }),
    })
    expect({ byTicket, byBearer, byCookie }).toEqual({
      byTicket: [404, 404, 404, 404, 404],
      byBearer: [404, 404, 404, 404, 404],
      byCookie: [404, 404, 404, 404, 404],
    })
  })

  it("ends the account's sessions within a recheck of its removal, and a new ticket opens again", async () => {
    const opened = await open({ caller: CALLER_KINDS.member, id: plane.ids.video })
    const [video = ''] = sessionRoutes({
      id: opened.id,
      session: opened.session,
      key: opened.capability,
    })
    await setStatus({ id: AUTH_TEST_IDS.friend, status: MEMBER_STATUSES.revoked })
    try {
      const started = Date.now()
      await eventually({
        read: async () => (await get({ url: video })).statusCode,
        check: (status) => status === 404,
        ms: ENDED_WITHIN_MS,
      })
      expect(Date.now() - started).toBeLessThan(ENDED_WITHIN_MS)
    } finally {
      await setStatus({ id: AUTH_TEST_IDS.friend, status: MEMBER_STATUSES.approved })
    }
    expect((await get({ url: video })).statusCode).toBe(404)
    const reopened = await open({ caller: CALLER_KINDS.member, id: plane.ids.video })
    expect(
      await statusesOf({
        urls: sessionRoutes({
          id: reopened.id,
          session: reopened.session,
          key: reopened.capability,
        }),
      }),
    ).toEqual([200, 200, 200, 200, 200])
  })

  it('puts the capability and the ticket in no log line', async () => {
    const logged = LOG_METHODS.map((method) =>
      vi.spyOn(Logger.prototype, method).mockImplementation(() => undefined),
    )
    const printed = CONSOLE_METHODS.map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    )
    try {
      const opened = await open({ caller: CALLER_KINDS.guest, id: plane.ids.video })
      const urls = sessionRoutes({ id: opened.id, session: opened.session, key: opened.capability })
      await statusesOf({ urls })
      await statusesOf({
        urls: sessionRoutes({ id: other, session: opened.session, key: opened.capability }),
      })
      const lines = () =>
        JSON.stringify([...logged, ...printed].flatMap((spy) => spy.mock.calls.flat().map(String)))
      // An outage makes the session's recheck warn, and keeps it.
      fixture.state.failure = AUTH_TEST_FAILURES.network
      try {
        await eventually({
          read: async () => lines(),
          check: (text) => text.includes('keeping it'),
        })
      } finally {
        fixture.state.failure = AUTH_TEST_FAILURES.none
      }
      expect(await statusesOf({ urls })).toEqual([200, 200, 200, 200, 200])
      await setStatus({ id: AUTH_TEST_IDS.guest, status: MEMBER_STATUSES.revoked })
      try {
        await eventually({
          read: async () => (await get({ url: urls[0] ?? '' })).statusCode,
          check: (status) => status === 404,
          ms: ENDED_WITHIN_MS,
        })
      } finally {
        await setStatus({ id: AUTH_TEST_IDS.guest, status: MEMBER_STATUSES.approved })
      }
      expect(lines()).toContain('keeping it')
      expect(lines()).not.toContain(opened.capability)
      expect(lines()).not.toContain(opened.ticket)
    } finally {
      ;[...logged, ...printed].forEach((spy) => spy.mockRestore())
    }
  })

  it("opens nothing off its session's routes, and binds nothing on the open ping", async () => {
    const opened = await open({ caller: CALLER_KINDS.member, id: plane.ids.video })
    const params = { id: opened.id, trackId: sidecars.get(opened.id) ?? '' }
    const master = `${pathOf({ route: ROUTES.hlsMaster, params })}?${toQueryString({
      [HLS_PARAMS.mode]: PLAYBACK_MODES.remux,
      [MEDIA_TICKET_PARAM]: opened.capability,
    })}`
    const elsewhere = [ROUTES.file, ROUTES.stream, ROUTES.tracks, ROUTES.subtitles].map((route) =>
      withTicket({ route, params, ticket: opened.capability }),
    )
    const urls = [master, ...elsewhere]
    expect(await refusalsOf({ urls })).toEqual(urls.map(() => SIGNED_OUT))
    expect(
      await statusesOf({ urls: [withTicket({ route: ROUTES.ping, ticket: opened.capability })] }),
    ).toEqual([200])
  })

  it('refuses a repeated ticket on every HLS route as a ticket that opens nothing', async () => {
    const member = await bearerOf(CALLER_KINDS.member)
    const master = `${pathOf({ route: ROUTES.hlsMaster, params: { id: plane.ids.video } })}?${toQueryString(
      { [HLS_PARAMS.mode]: PLAYBACK_MODES.remux },
    )}`
    const opening = await get({ url: master, headers: member })
    expect(opening.statusCode).toBe(200)
    const urls = [
      master,
      ...sessionRoutes({ id: plane.ids.video, session: hlsSessionIn(opening.body), key: null }),
    ]
    const capability = await open({ caller: CALLER_KINDS.member, id: plane.ids.video })
    const ofCapability = sessionRoutes({
      id: capability.id,
      session: capability.session,
      key: null,
    })
    const repeated = (url: string): string => `${url}${url.includes('?') ? '&' : '?'}${REPEATED}`

    expect(await statusesOf({ urls, headers: member })).toEqual(urls.map(() => 200))
    expect({
      withBearer: await refusalsOf({ urls: urls.map(repeated), headers: member }),
      alone: await refusalsOf({ urls: urls.map(repeated) }),
      onCapability: await refusalsOf({ urls: ofCapability.map(repeated), headers: member }),
    }).toEqual({
      withBearer: urls.map(() => SIGNED_OUT),
      alone: urls.map(() => SIGNED_OUT),
      onCapability: ofCapability.map(() => SIGNED_OUT),
    })
  })

  it("shuts a member's session at once when its library is locked after it opened", async () => {
    const opened = await open({ caller: CALLER_KINDS.member, id: plane.ids.video })
    const urls = sessionRoutes({ id: opened.id, session: opened.session, key: opened.capability })
    expect(await statusesOf({ urls })).toEqual([200, 200, 200, 200, 200])
    await setLocked({ isLocked: true })
    try {
      expect(await statusesOf({ urls })).toEqual([404, 404, 404, 404, 404])
    } finally {
      await setLocked({ isLocked: false })
    }
    expect(await statusesOf({ urls })).toEqual([200, 200, 200, 200, 200])
  })

  it('ends the session within a recheck of a failed integrity check', async () => {
    const opened = await open({ caller: CALLER_KINDS.member, id: plane.ids.video })
    const [video = ''] = sessionRoutes({
      id: opened.id,
      session: opened.session,
      key: opened.capability,
    })
    fixture.state.failure = AUTH_TEST_FAILURES.wrongAccount
    try {
      // The member's last answer is reused for its TTL before a recheck asks again.
      await eventually({
        read: async () => (await get({ url: video })).statusCode,
        check: (status) => status === 404,
        ms: MEMBERSHIP_TTL_MS + ENDED_WITHIN_MS,
      })
    } finally {
      fixture.state.failure = AUTH_TEST_FAILURES.none
    }
    expect((await get({ url: video })).statusCode).toBe(404)
  })
})
