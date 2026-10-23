import { randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AUTH_HEADERS,
  AUTH_REFUSALS,
  ITEM_IMAGE_KINDS,
  LIBRARY_KINDS,
  MEMBER_STATUSES,
  type MemberStatusChange,
  TITLE_DISPLAYS,
  WATCH_TARGET_KINDS,
  isLibrary,
  isMediaTicket,
} from '@raven/core'
import { CACHE_POLICIES, HEADERS } from '@shared/server'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '@/app'
import { CONTROLLERS } from '@/appModule'
import { ACCOUNT_REQUIREMENTS } from '@/auth/accountGuard'
import { AuthSessions } from '@/auth/authSessions'
import { MEMBERSHIP_TTL_MS } from '@/auth/membershipLookups'
import { RAVEN_CACHE_POLICIES } from '@/http'
import { OWNER_SCAN_ERROR } from '@/libraries/librariesController'
import { MediaTickets } from '@/media/mediaTickets'
import { type RouteMark, routeMarks } from '@/routeMarks'
import { ScannerService } from '@/scanner/scannerService'
import {
  ADMIN_PASSWORD,
  type InjectOptions,
  NOT_WATCHING,
  ROUTE_METHODS,
  type RouteMethod,
  adminCookie,
  testConfig,
} from '@/test/app'
import {
  AUTH_TEST_FAILURES,
  AUTH_TEST_IDS,
  FORGED_ALGORITHMS,
  MISADDRESSED_CLAIMS,
  RPC_PATHS,
  authCookie,
  authFixture,
  bearerHeaders,
} from '@/test/auth'
import {
  CALLER_KINDS,
  type CallerKind,
  ROUTES,
  type Route,
  TOKEN_CARRIERS,
  createEnforcedApp,
  headersFor,
  outcomeOf,
  pathOf,
  withTicket,
} from '@/test/enforced'

let root: string
let fixture: Awaited<ReturnType<typeof authFixture>>
let enforced: Awaited<ReturnType<typeof createEnforcedApp>>

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'raven-enforcement-'))
  fixture = await authFixture()
  enforced = await createEnforcedApp({ root, fixture, mediaSecret: randomBytes(32) })
})

afterAll(async () => {
  await enforced.app.close()
  await rm(root, { recursive: true, force: true, maxRetries: 5 })
})

beforeEach(() => {
  fixture.state.failure = AUTH_TEST_FAILURES.none
  fixture.fetcher.mockClear()
})

const ROUTE_LIST: readonly Route[] = Object.values(ROUTES)

type Declared = Pick<RouteMark, 'method' | 'path'>

const byRoute = (a: Declared, b: Declared): number =>
  `${a.path} ${a.method}`.localeCompare(`${b.path} ${b.method}`)

type Sent = { route: Route; method: RouteMethod }

/** Each route as it is sent: a GET also as the HEAD Fastify answers for it, through the same guards. */
const asSent = (routes: readonly Route[]): Sent[] =>
  routes.flatMap((route): Sent[] =>
    route.method === ROUTE_METHODS.get
      ? [
          { route, method: ROUTE_METHODS.get },
          { route, method: ROUTE_METHODS.head },
        ]
      : [{ route, method: route.method }],
  )

const send = ({ options }: { options: InjectOptions }) => enforced.app.inject(options)

const REFUSALS = {
  [CALLER_KINDS.anonymous]: { status: 401, reason: AUTH_REFUSALS.signedOut },
  [CALLER_KINDS.unverified]: { status: 403, reason: AUTH_REFUSALS.pending },
  [CALLER_KINDS.pending]: { status: 403, reason: AUTH_REFUSALS.pending },
  [CALLER_KINDS.revoked]: { status: 403, reason: AUTH_REFUSALS.revoked },
} as const

/** Whether a route refuses `caller`: every one not open to anyone, but `me` answers any account its own status. */
const refuses = ({ route, caller }: { route: Route; caller: keyof typeof REFUSALS }): boolean =>
  route.account !== ACCOUNT_REQUIREMENTS.anyone &&
  !(
    route.account === ACCOUNT_REQUIREMENTS.session &&
    (caller === CALLER_KINDS.pending || caller === CALLER_KINDS.revoked)
  )

it('declares every route exactly as the inventory says', () => {
  const declared = routeMarks(CONTROLLERS)
    .map(({ method, path, account }) => ({ method, path, account }))
    .toSorted(byRoute)
  expect(declared).toEqual(ROUTE_LIST.toSorted(byRoute))
  expect(declared.filter(({ account }) => account === ACCOUNT_REQUIREMENTS.anyone)).toEqual(
    [
      ROUTES.authConfig,
      ROUTES.health,
      ROUTES.ping,
      ROUTES.itemPicture,
      ROUTES.photoPicture,
    ].toSorted(byRoute),
  )
})

/** The open routes whose address is their own permission: they answer only a current version. */
const CAPABILITY_ROUTES: ReadonlySet<Route> = new Set([ROUTES.itemPicture, ROUTES.photoPicture])

describe('the default-deny gate', () => {
  it('refuses every protected route to anonymous, unverified, pending and revoked callers', async () => {
    const callers = [
      CALLER_KINDS.anonymous,
      CALLER_KINDS.unverified,
      CALLER_KINDS.pending,
      CALLER_KINDS.revoked,
    ] as const
    const observed = await Promise.all(
      callers.map(async (caller) => {
        const headers = await headersFor({ fixture, caller, via: TOKEN_CARRIERS.bearer })
        return Promise.all(
          asSent(ROUTE_LIST.filter((route) => refuses({ route, caller }))).map(
            async ({ route, method }) => {
              const response = await send({
                options: { method, url: pathOf({ route }), headers },
              })
              return { caller, method, path: route.path, ...outcomeOf({ response }) }
            },
          ),
        )
      }),
    )
    const expected = callers.map((caller) =>
      asSent(ROUTE_LIST.filter((route) => refuses({ route, caller }))).map(({ route, method }) => ({
        caller,
        method,
        path: route.path,
        status: REFUSALS[caller].status,
        reason: method === ROUTE_METHODS.head ? null : REFUSALS[caller].reason,
        isVariedByAccount: true,
        isNoStore: true,
      })),
    )
    expect(observed).toEqual(expected)
  })

  it('answers the open routes to anyone without asking about accounts', async () => {
    const open = asSent(
      ROUTE_LIST.filter(
        (route) => route.account === ACCOUNT_REQUIREMENTS.anyone && !CAPABILITY_ROUTES.has(route),
      ),
    )
    const callers: readonly CallerKind[] = [CALLER_KINDS.anonymous, CALLER_KINDS.member]
    const statuses = await Promise.all(
      callers.map(async (caller) => {
        const headers = await headersFor({ fixture, caller, via: TOKEN_CARRIERS.bearer })
        return Promise.all(
          open.map(
            async ({ route, method }) =>
              (await send({ options: { method, url: pathOf({ route }), headers } })).statusCode,
          ),
        )
      }),
    )
    expect(statuses.flat()).toEqual(Array.from({ length: open.length * callers.length }, () => 200))
    expect(fixture.fetcher).not.toHaveBeenCalled()
  })

  it('answers a picture to anyone naming its current version, for any cache to keep, and no other', async () => {
    const { item } = enforced.ids
    if (item === null) throw new Error('The enforced library matched no item')
    const { posterVersion } = await enforced.ownerApi.getItem(item)
    if (posterVersion === null) throw new Error('The enforced movie has no poster')
    fixture.fetcher.mockClear()
    const picture = ({ version }: { version: string }) =>
      send({
        options: {
          url: pathOf({
            route: ROUTES.itemPicture,
            params: { id: item, kind: ITEM_IMAGE_KINDS.poster, version },
          }),
        },
      })

    const shown = await picture({ version: posterVersion })
    expect({
      status: shown.statusCode,
      cacheControl: shown.headers[HEADERS.cacheControl],
      isVariedByAccount: outcomeOf({ response: shown }).isVariedByAccount,
    }).toEqual({ status: 200, cacheControl: CACHE_POLICIES.immutable, isVariedByAccount: false })

    const guesses = await Promise.all(
      [
        '1',
        `${posterVersion.slice(0, -1)}${posterVersion.endsWith('A') ? 'B' : 'A'}`,
        `${posterVersion}x`,
      ].map(async (version) => (await picture({ version })).statusCode),
    )
    expect(guesses).toEqual([404, 404, 404])
    expect(fixture.fetcher).not.toHaveBeenCalled()
  })

  it('refuses every write sent with only the cookie', async () => {
    const headers = await headersFor({
      fixture,
      caller: CALLER_KINDS.member,
      via: TOKEN_CARRIERS.cookie,
    })
    const writes = ROUTE_LIST.filter(({ method }) => method !== ROUTE_METHODS.get)
    const observed = await Promise.all(
      writes.map(async (route) => {
        const response = await send({
          options: { method: route.method, url: pathOf({ route }), headers },
        })
        return { path: route.path, ...outcomeOf({ response }) }
      }),
    )
    expect(observed).toEqual(
      writes.map(({ path }) => ({
        path,
        status: 401,
        reason: AUTH_REFUSALS.signedOut,
        isVariedByAccount: true,
        isNoStore: true,
      })),
    )
  })

  it('never takes a legacy media ticket for an account', async () => {
    const id = enforced.ids.video
    const tickets = enforced.app.get(MediaTickets)
    const { ticket } = tickets.issue({ id })
    expect(tickets.verify({ ticket, id })).toBe(true)
    const responses = await Promise.all(
      [ROUTES.file, ROUTES.stream, ROUTES.hlsMaster].map((route) =>
        send({ options: { url: withTicket({ route, params: { id }, ticket }) } }),
      ),
    )
    responses.forEach((response) =>
      expect(outcomeOf({ response })).toMatchObject({
        status: 401,
        reason: AUTH_REFUSALS.signedOut,
      }),
    )
  })

  it('lets an approved member read with the cookie alone', async () => {
    const headers = await headersFor({
      fixture,
      caller: CALLER_KINDS.member,
      via: TOKEN_CARRIERS.cookie,
    })
    const statuses = await Promise.all(
      asSent([ROUTES.libraries]).map(
        async ({ route, method }) =>
          (await send({ options: { method, url: pathOf({ route }), headers } })).statusCode,
      ),
    )
    expect(statuses).toEqual([200, 200])
  })
})

describe('tokens on an approved route', () => {
  const libraries = ({ headers }: { headers: Record<string, string> }) =>
    send({ options: { url: ROUTES.libraries.path, headers } })

  it('refuses tokens that are expired, misaddressed, forged or garbage', async () => {
    const tokens = await Promise.all([
      fixture.mint({ expiresIn: -60 }),
      fixture.mint({ issuer: MISADDRESSED_CLAIMS.issuer }),
      fixture.mint({ audience: MISADDRESSED_CLAIMS.audience }),
      fixture.forge({ algorithm: FORGED_ALGORITHMS.symmetric }),
      fixture.forge({ algorithm: FORGED_ALGORITHMS.none }),
      Promise.resolve('not-a-jwt'),
    ])
    const outcomes = await Promise.all(
      tokens.map(async (token) =>
        outcomeOf({ response: await libraries({ headers: bearerHeaders({ token }) }) }),
      ),
    )
    expect(outcomes.map(({ status, reason }) => ({ status, reason }))).toEqual(
      tokens.map(() => ({ status: 401, reason: AUTH_REFUSALS.signedOut })),
    )
  })

  it.each([
    AUTH_TEST_FAILURES.network,
    AUTH_TEST_FAILURES.malformed,
    AUTH_TEST_FAILURES.wrongAccount,
    AUTH_TEST_FAILURES.ambiguous,
  ])('answers 503 when membership cannot be trusted: %s', async (failure) => {
    const headers = await headersFor({
      fixture,
      caller: CALLER_KINDS.member,
      via: TOKEN_CARRIERS.bearer,
    })
    fixture.state.failure = failure
    expect(outcomeOf({ response: await libraries({ headers }) })).toMatchObject({
      status: 503,
      reason: AUTH_REFUSALS.unavailable,
    })
  })

  it('refuses a bad Bearer even beside a valid owner cookie', async () => {
    const owner = await fixture.mint({ id: AUTH_TEST_IDS.owner })
    const response = await libraries({
      headers: {
        ...bearerHeaders({ token: 'not-a-jwt' }),
        [AUTH_HEADERS.cookie]: authCookie({ token: owner }),
      },
    })
    expect(outcomeOf({ response })).toMatchObject({
      status: 401,
      reason: AUTH_REFUSALS.signedOut,
    })
  })
})

it('lets an approved member read, write and fetch artwork', async () => {
  const { library, video, item } = enforced.ids
  if (item === null) throw new Error('The enforced library matched no item')
  const headers = await headersFor({
    fixture,
    caller: CALLER_KINDS.member,
    via: TOKEN_CARRIERS.bearer,
  })
  const get = ({ route, params }: { route: Route; params?: Record<string, number | string> }) =>
    send({ options: { url: pathOf({ route, params }), headers } })

  const reads = await Promise.all(
    [
      get({ route: ROUTES.libraries }),
      get({ route: ROUTES.libraryMedia, params: { id: library } }),
      get({ route: ROUTES.media, params: { id: video } }),
      get({ route: ROUTES.item, params: { id: item } }),
      get({ route: ROUTES.home }),
    ].map(async (request) => outcomeOf({ response: await request })),
  )
  expect(reads).toEqual(
    reads.map(() => ({ status: 200, reason: null, isVariedByAccount: true, isNoStore: true })),
  )

  const artwork = await Promise.all([
    get({ route: ROUTES.thumbnail, params: { id: video } }),
    get({ route: ROUTES.itemImage, params: { id: item, kind: ITEM_IMAGE_KINDS.poster } }),
  ])
  // The browser alone may keep a picture; a shared cache never may.
  expect(
    artwork.map((response) => ({
      status: response.statusCode,
      cacheControl: response.headers[HEADERS.cacheControl],
      isVariedByAccount: outcomeOf({ response }).isVariedByAccount,
    })),
  ).toEqual(
    artwork.map(() => ({
      status: 200,
      cacheControl: RAVEN_CACHE_POLICIES.privateMinute,
      isVariedByAccount: true,
    })),
  )

  const progress = await send({
    options: {
      method: ROUTES.progress.method,
      url: pathOf({ route: ROUTES.progress, params: { id: video } }),
      headers,
      payload: { position: 1 },
    },
  })
  expect(progress.statusCode).toBe(204)
  const watched = await send({
    options: {
      method: ROUTES.watched.method,
      url: ROUTES.watched.path,
      headers,
      payload: { watched: true, targets: [{ kind: WATCH_TARGET_KINDS.media, id: video }] },
    },
  })
  expect(watched.statusCode).toBe(204)
})

describe('owner-only management', () => {
  const asMember = () =>
    headersFor({ fixture, caller: CALLER_KINDS.member, via: TOKEN_CARRIERS.bearer })
  const asOwner = () =>
    headersFor({ fixture, caller: CALLER_KINDS.owner, via: TOKEN_CARRIERS.bearer })

  it('refuses every owner route to an approved member', async () => {
    const ownerRoutes = ROUTE_LIST.filter(({ account }) => account === ACCOUNT_REQUIREMENTS.owner)
    expect(ownerRoutes).toHaveLength(28)
    const headers = await asMember()
    const observed = await Promise.all(
      asSent(ownerRoutes).map(async ({ route, method }) => {
        const response = await send({ options: { method, url: pathOf({ route }), headers } })
        return { method, path: route.path, ...outcomeOf({ response }) }
      }),
    )
    expect(observed).toEqual(
      asSent(ownerRoutes).map(({ route, method }) => ({
        method,
        path: route.path,
        status: 403,
        reason: method === ROUTE_METHODS.head ? null : AUTH_REFUSALS.notOwner,
        isVariedByAccount: true,
        isNoStore: true,
      })),
    )
  })

  it('lets the owner manage', async () => {
    const headers = await asOwner()
    const { video } = enforced.ids
    const display = await send({
      options: {
        method: ROUTES.saveDisplaySettings.method,
        url: ROUTES.saveDisplaySettings.path,
        headers,
        payload: { titles: TITLE_DISPLAYS.text },
      },
    })
    const reads = await Promise.all(
      [
        send({ options: { url: ROUTES.streams.path, headers } }),
        send({ options: { url: ROUTES.browse.path, headers } }),
        send({
          options: { url: pathOf({ route: ROUTES.location, params: { id: video } }), headers },
        }),
      ].map(async (request) => (await request).statusCode),
    )
    expect([display.statusCode, ...reads]).toEqual([200, 200, 200, 200])

    const created = await send({
      options: {
        method: ROUTES.createLibrary.method,
        url: ROUTES.createLibrary.path,
        headers,
        payload: {
          name: 'Made by the owner',
          paths: [enforced.mediaDir],
          settings: { kind: LIBRARY_KINDS.movies },
        },
      },
    })
    const library: unknown = created.json()
    if (!isLibrary(library)) throw new Error('The owner made no library')
    const removed = await send({
      options: {
        method: ROUTES.deleteLibrary.method,
        url: pathOf({ route: ROUTES.deleteLibrary, params: { id: library.id } }),
        headers,
      },
    })
    expect([created.statusCode, removed.statusCode]).toEqual([201, 204])
  })

  it('gives the old admin password nothing', async () => {
    const headers = await asMember()
    const unlock = await send({
      options: {
        method: ROUTES.adminUnlock.method,
        url: ROUTES.adminUnlock.path,
        headers,
        payload: { password: ADMIN_PASSWORD },
      },
    })
    expect(unlock.statusCode).toBe(404)
    expect(unlock.headers[HEADERS.setCookie]).toBeUndefined()
  })

  it('answers the admin lock routes 404 even to the owner', async () => {
    const headers = await asOwner()
    const lock = asSent([ROUTES.adminLock, ROUTES.adminRelock, ROUTES.adminKeepUnlocked])
    const statuses = await Promise.all(
      lock.map(
        async ({ route, method }) =>
          (await send({ options: { method, url: route.path, headers } })).statusCode,
      ),
    )
    expect(statuses).toEqual(lock.map(() => 404))
  })

  it('shows folders to the owner and hides them from a member', async () => {
    const foldersSeenBy = async ({ headers }: { headers: Record<string, string> }) => {
      const response = await send({ options: { url: ROUTES.libraries.path, headers } })
      const body: unknown = response.json()
      return Array.isArray(body) ? body.filter(isLibrary).map(({ paths }) => paths) : []
    }
    expect(await foldersSeenBy({ headers: await asMember() })).toEqual([[]])
    expect(await foldersSeenBy({ headers: await asOwner() })).toEqual([[enforced.mediaDir]])
  })

  it("tells a member a library's scan failed without naming its folders or the admin lock", async () => {
    const created = await enforced.ownerApi.createLibrary({
      name: 'Gone',
      paths: [join(enforced.mediaDir, 'Missing')],
    })
    await enforced.app.get(ScannerService).whenIdle(created.id)
    const scanErrorFor = async ({ headers }: { headers: Record<string, string> }) => {
      const response = await send({
        options: { url: pathOf({ route: ROUTES.library, params: { id: created.id } }), headers },
      })
      const body: unknown = response.json()
      return isLibrary(body) ? body.scan.error : null
    }
    try {
      expect(await scanErrorFor({ headers: await asMember() })).toBe(OWNER_SCAN_ERROR)
      expect(await scanErrorFor({ headers: await asOwner() })).toContain('Missing')
    } finally {
      await enforced.ownerApi.deleteLibrary(created.id)
    }
  })
})

describe('an admin cookie from before accounts', () => {
  const displayChange = ({ headers }: { headers: Record<string, string> }) => ({
    method: ROUTES.saveDisplaySettings.method,
    url: ROUTES.saveDisplaySettings.path,
    headers,
    payload: { titles: TITLE_DISPLAYS.text },
  })

  /** The admin cookie a server with accounts off gives, which manages there. */
  const mintAdminCookie = async ({ dir }: { dir: string }): Promise<string> => {
    const before = await createApp({
      config: testConfig({ dataDir: join(dir, 'data'), mediaDir: join(dir, 'media') }),
      quiet: true,
      watch: NOT_WATCHING,
    })
    try {
      await before.init()
      const cookie = await adminCookie(before)
      const managed = await before.inject(
        displayChange({ headers: { [AUTH_HEADERS.cookie]: cookie } }),
      )
      expect(managed.statusCode).toBe(200)
      return cookie
    } finally {
      await before.close()
    }
  }

  it('manages nothing once the same data runs with accounts ready', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'raven-admin-cookie-'))
    try {
      const cookie = await mintAdminCookie({ dir })
      const after = await createEnforcedApp({ root: dir, fixture })
      try {
        const member = await headersFor({
          fixture,
          caller: CALLER_KINDS.member,
          via: TOKEN_CARRIERS.bearer,
        })
        const response = await after.app.inject(
          displayChange({ headers: { ...member, [AUTH_HEADERS.cookie]: cookie } }),
        )
        expect(outcomeOf({ response })).toMatchObject({
          status: 403,
          reason: AUTH_REFUSALS.notOwner,
        })
      } finally {
        await after.app.close()
      }
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 5 })
    }
  })
})

describe('membership lookups shared between requests', () => {
  const CONCURRENT_REQUESTS = 30
  const FIRST_BYTES = { [HEADERS.range]: 'bytes=0-99' }

  const callsTo = ({ path }: { path: string }) =>
    fixture.fetcher.mock.calls.filter(([{ url }]) => url.endsWith(path)).length

  const membershipCalls = () => callsTo({ path: RPC_PATHS.current })

  const memberToken = () => fixture.mint({ id: AUTH_TEST_IDS.friend })

  const setMember = ({ status }: { status: MemberStatusChange['status'] }) =>
    enforced.ownerApi.setMemberStatus({ id: AUTH_TEST_IDS.friend, change: { status } })

  const library = ({ token }: { token: string }) =>
    enforced.app.inject({ url: ROUTES.libraries.path, headers: bearerHeaders({ token }) })

  afterEach(async () => {
    vi.useRealTimers()
    await setMember({ status: MEMBER_STATUSES.approved })
  })

  it('asks Supabase once for a library page of requests under one token', async () => {
    const token = await memberToken()
    const responses = await Promise.all(
      Array.from({ length: CONCURRENT_REQUESTS }, () => library({ token })),
    )
    expect(responses.map(({ statusCode }) => statusCode)).toEqual(
      Array.from({ length: CONCURRENT_REQUESTS }, () => 200),
    )
    expect(membershipCalls()).toBe(1)
    await library({ token })
    expect(membershipCalls()).toBe(1)
  })

  it('gives the next request and the next ticket redemption 403 revoked as soon as the owner removes the member', async () => {
    const token = await memberToken()
    const headers = bearerHeaders({ token })
    expect((await library({ token })).statusCode).toBe(200)
    const minted: unknown = (
      await enforced.app.inject({
        method: ROUTES.accountTicket.method,
        url: pathOf({ route: ROUTES.accountTicket, params: { id: enforced.ids.video } }),
        headers,
      })
    ).json()
    if (!isMediaTicket(minted)) throw new Error('No ticket was minted')
    const redeem = () =>
      enforced.app.inject({
        url: withTicket({
          route: ROUTES.file,
          params: { id: enforced.ids.video },
          ticket: minted.ticket,
        }),
        headers: FIRST_BYTES,
      })
    expect((await redeem()).statusCode).toBe(206)
    const remembered = () =>
      enforced.app.get(AuthSessions).freshestFor({ accountId: AUTH_TEST_IDS.friend })
    expect(remembered()).not.toBeNull()

    await setMember({ status: MEMBER_STATUSES.revoked })

    expect(remembered()).toBeNull()
    expect(outcomeOf({ response: await library({ token }) })).toMatchObject({
      status: 403,
      reason: AUTH_REFUSALS.revoked,
    })
    expect(outcomeOf({ response: await redeem() })).toMatchObject({
      status: 403,
      reason: AUTH_REFUSALS.revoked,
    })
  })

  it('forgets the member even when the response to the owner is lost after the change', async () => {
    const token = await memberToken()
    expect((await library({ token })).statusCode).toBe(200)
    const answer = fixture.fetcher.getMockImplementation()
    if (answer === undefined) throw new Error('The auth fixture has no answer')
    fixture.fetcher.mockImplementation(async (call) => {
      const response = await answer(call)
      if (call.url.endsWith(RPC_PATHS.status)) throw new Error('The response was lost')
      return response
    })
    try {
      await expect(setMember({ status: MEMBER_STATUSES.revoked })).rejects.toThrow()
    } finally {
      fixture.fetcher.mockImplementation(answer)
    }
    expect(outcomeOf({ response: await library({ token }) })).toMatchObject({
      status: 403,
      reason: AUTH_REFUSALS.revoked,
    })
  })

  it('sees the owner approve a removed member again at once', async () => {
    const token = await memberToken()
    await setMember({ status: MEMBER_STATUSES.revoked })
    expect((await library({ token })).statusCode).toBe(403)
    await setMember({ status: MEMBER_STATUSES.approved })
    expect((await library({ token })).statusCode).toBe(200)
  })

  it('sees a change made straight in the database only once the TTL is up', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const token = await memberToken()
    expect((await library({ token })).statusCode).toBe(200)
    const friend = fixture.accounts[AUTH_TEST_IDS.friend]
    if (friend === undefined) throw new Error('Missing friend fixture')
    fixture.accounts[AUTH_TEST_IDS.friend] = { ...friend, status: MEMBER_STATUSES.revoked }
    vi.advanceTimersByTime(MEMBERSHIP_TTL_MS - 1)
    expect((await library({ token })).statusCode).toBe(200)
    vi.advanceTimersByTime(1)
    expect(outcomeOf({ response: await library({ token }) })).toMatchObject({
      status: 403,
      reason: AUTH_REFUSALS.revoked,
    })
  })

  it('never reuses a failed lookup', async () => {
    const token = await memberToken()
    fixture.state.failure = AUTH_TEST_FAILURES.network
    expect(outcomeOf({ response: await library({ token }) })).toMatchObject({
      status: 503,
      reason: AUTH_REFUSALS.unavailable,
    })
    fixture.state.failure = AUTH_TEST_FAILURES.none
    expect((await library({ token })).statusCode).toBe(200)
  })

  it('looks up the owner calls themselves every time', async () => {
    const headers = await headersFor({
      fixture,
      caller: CALLER_KINDS.owner,
      via: TOKEN_CARRIERS.bearer,
    })
    const before = callsTo({ path: RPC_PATHS.list })
    await enforced.app.inject({ url: ROUTES.members.path, headers })
    await enforced.app.inject({ url: ROUTES.members.path, headers })
    expect(callsTo({ path: RPC_PATHS.list }) - before).toBe(2)
  })
})
