import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import {
  AUTH_CONFIG_STATES,
  AUTH_HEADERS,
  AUTH_METHODS,
  AUTH_PARAMS,
  AUTH_PATHS,
  AUTH_REFUSALS,
  LOCKED_STATUS,
  MEMBER_STATUSES,
  SERVER_COOKIES,
  createApiClient,
  isMediaTicket,
} from '@raven/core'
import { CACHE_POLICIES, HEADERS } from '@shared/server'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '@/app'
import { ACCOUNT_TICKET_PREFIX, AccountTickets } from '@/auth/accountTickets'
import { AuthSessions } from '@/auth/authSessions'
import { readServerConfig, type ServerConfig } from '@/config'
import { SettingsRepository } from '@/settings/settingsRepository'
import { ScannerService } from '@/scanner/scannerService'
import {
  AUTH_TEST_CONFIG,
  AUTH_TEST_FAILURES,
  AUTH_TEST_IDS,
  authCookie,
  authFixture,
  bearerHeaders,
} from '@/test/auth'
import { NOT_WATCHING, cookieSet, testConfig } from '@/test/app'
import { encodeClip } from '@/test/clips'
import { ROUTES, withTicket } from '@/test/enforced'
import { injectFetch } from '@/test/server'

/** A cookie shaped like the admin lock's, which a server with accounts ready gives no meaning. */
const ADMIN_COOKIE_BEFORE_ACCOUNTS = `${SERVER_COOKIES.admin}=1.2.${'x'.repeat(43)}`

const LIBRARY_PIN = '3001'
/** These tests change accounts, and the state of the auth service, under tokens they have already used. */
const NO_REUSE_MS = 0

type AccountPathProps = { path: string; id: string | number }

const accountPath = ({ path, id }: AccountPathProps) =>
  path.replace(`:${AUTH_PARAMS.id}`, String(id))

let app: NestFastifyApplication
let root: string
let fixture: Awaited<ReturnType<typeof authFixture>>
let video: number
let friendToken: string
let ownerToken: string
/** The owner's client: Bearer alone manages. */
let manager: ReturnType<typeof createApiClient>

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'raven-auth-'))
  const mediaDir = join(root, 'media')
  await encodeClip({ path: join(mediaDir, 'Auth.Test.2026.mp4') })
  fixture = await authFixture()
  app = await createApp({
    config: {
      ...testConfig({ dataDir: join(root, 'data'), mediaDir }),
      auth: AUTH_TEST_CONFIG,
      libraryPin: LIBRARY_PIN,
    },
    authKeys: fixture.keys,
    authFetch: fixture.fetcher,
    quiet: true,
    watch: NOT_WATCHING,
    membershipTtlMs: NO_REUSE_MS,
  })
  await app.init()
  await app.getHttpAdapter().getInstance().ready()
  friendToken = await fixture.mint()
  ownerToken = await fixture.mint({ id: AUTH_TEST_IDS.owner })
  manager = createApiClient({
    fetch: injectFetch({ app }),
    accessToken: () => ownerToken,
  })
  const library = await manager.createLibrary({ name: 'Auth test', paths: [mediaDir] })
  await app.get(ScannerService).whenIdle(library.id)
  const first = (await manager.listMedia({ libraryId: library.id }))[0]
  if (first === undefined) throw new Error('Missing test video')
  video = first.id
})

afterAll(async () => {
  await app.close()
  await rm(root, { recursive: true, force: true, maxRetries: 5 })
})

beforeEach(() => {
  fixture.state.failure = AUTH_TEST_FAILURES.none
  const friend = fixture.accounts[AUTH_TEST_IDS.friend]
  const pending = fixture.accounts[AUTH_TEST_IDS.pending]
  if (friend === undefined || pending === undefined) throw new Error('Missing account fixture')
  fixture.accounts[AUTH_TEST_IDS.friend] = { ...friend, status: MEMBER_STATUSES.approved }
  fixture.accounts[AUTH_TEST_IDS.pending] = { ...pending, status: MEMBER_STATUSES.pending }
  fixture.fetcher.mockClear()
})

describe('account endpoints', () => {
  it('publishes only safe auth config without a session', async () => {
    const response = await app.inject({ url: AUTH_PATHS.config })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(AUTH_TEST_CONFIG)
    expect(response.headers[HEADERS.cacheControl]).toBe(CACHE_POLICIES.noStore)
    expect(fixture.fetcher).not.toHaveBeenCalled()
  })

  it('keeps health open and holds the library to an account', async () => {
    const responses = await Promise.all(
      [ROUTES.health.path, ROUTES.libraries.path].map((url) => app.inject({ url })),
    )
    expect(responses.map(({ statusCode }) => statusCode)).toEqual([200, 401])
    expect(fixture.fetcher).not.toHaveBeenCalled()
  })

  it('requires real identity, not the old admin cookie', async () => {
    const response = await app.inject({
      url: AUTH_PATHS.members,
      headers: { [AUTH_HEADERS.cookie]: ADMIN_COOKIE_BEFORE_ACCOUNTS },
    })
    expect(response.statusCode).toBe(401)
    expect(response.json()).toMatchObject({ reason: AUTH_REFUSALS.signedOut })
  })

  it('returns the current account for Bearer or a read-only browser cookie', async () => {
    const client = createApiClient({ fetch: injectFetch({ app }), accessToken: () => friendToken })
    expect(await client.getMe()).toEqual(fixture.accounts[AUTH_TEST_IDS.friend])
    const response = await app.inject({
      url: AUTH_PATHS.me,
      headers: { cookie: authCookie({ token: friendToken }) },
    })
    expect(response.statusCode).toBe(200)
    expect(response.headers[HEADERS.cacheControl]).toBe(CACHE_POLICIES.noStore)
    expect(response.headers[HEADERS.vary]).toContain(AUTH_HEADERS.authorization)
    expect(JSON.stringify(response.json())).not.toContain(friendToken)
  })

  it('lets a pending or removed account see only its own status', async () => {
    await Promise.all(
      [AUTH_TEST_IDS.pending, AUTH_TEST_IDS.revoked].map(async (id) => {
        const response = await app.inject({
          url: AUTH_PATHS.me,
          headers: bearerHeaders({ token: await fixture.mint({ id }) }),
        })
        expect(response.statusCode).toBe(200)
        expect(response.json()).toEqual(fixture.accounts[id])
      }),
    )
  })

  it('refuses a missing membership instead of inventing an approved account', async () => {
    const response = await app.inject({
      url: AUTH_PATHS.me,
      headers: bearerHeaders({ token: await fixture.mint({ id: AUTH_TEST_IDS.missing }) }),
    })
    expect(response.statusCode).toBe(403)
    expect(response.json()).toMatchObject({ reason: AUTH_REFUSALS.pending })
  })

  it('refuses bad Bearer even when a valid owner cookie is also present', async () => {
    const response = await app.inject({
      url: AUTH_PATHS.members,
      headers: {
        ...bearerHeaders({ token: 'not-a-jwt' }),
        cookie: authCookie({ token: ownerToken }),
      },
    })
    expect(response.statusCode).toBe(401)
  })

  it('does not trust a role or approval claim supplied in a valid JWT', async () => {
    const token = await fixture.mint({
      claims: {
        maester: { role: 'admin', status: MEMBER_STATUSES.approved },
        user_metadata: { is_owner: true },
      },
    })
    const response = await app.inject({
      url: AUTH_PATHS.members,
      headers: bearerHeaders({ token }),
    })
    expect(response.statusCode).toBe(403)
    expect(response.json()).toMatchObject({ reason: AUTH_REFUSALS.notOwner })
  })

  it('allows only the approved owner to list members, with bounded pagination', async () => {
    const client = createApiClient({ fetch: injectFetch({ app }), accessToken: () => ownerToken })
    expect(await client.listMembers({ pageSize: 1, pageOffset: 1 })).toHaveLength(1)
    const invalid = await app.inject({
      url: `${AUTH_PATHS.members}?${AUTH_PARAMS.pageSize}=101`,
      headers: bearerHeaders({ token: ownerToken }),
    })
    expect(invalid.statusCode).toBe(400)
    await Promise.all(
      [AUTH_TEST_IDS.friend, AUTH_TEST_IDS.pending, AUTH_TEST_IDS.revoked].map(async (id) => {
        const response = await app.inject({
          url: AUTH_PATHS.members,
          headers: bearerHeaders({ token: await fixture.mint({ id }) }),
        })
        expect(response.statusCode).toBe(403)
      }),
    )
  })

  it('rejects repeated, negative or unsafe pagination values at the query boundary', async () => {
    await Promise.all(
      [
        `${AUTH_PARAMS.pageSize}=1&${AUTH_PARAMS.pageSize}=2`,
        `${AUTH_PARAMS.pageOffset}=-1`,
        `${AUTH_PARAMS.pageOffset}=9007199254740992`,
      ].map(async (query) => {
        expect(
          (
            await app.inject({
              url: `${AUTH_PATHS.members}?${query}`,
              headers: bearerHeaders({ token: ownerToken }),
            })
          ).statusCode,
        ).toBe(400)
      }),
    )
  })

  it('requires Bearer for approval writes, not a readable session cookie', async () => {
    const response = await app.inject({
      method: AUTH_METHODS.post,
      url: accountPath({ path: AUTH_PATHS.memberStatus, id: AUTH_TEST_IDS.pending }),
      headers: { cookie: authCookie({ token: ownerToken }) },
      payload: { status: MEMBER_STATUSES.approved },
    })
    expect(response.statusCode).toBe(401)
  })

  it('approves and removes a member without reissuing their JWT', async () => {
    const client = createApiClient({ fetch: injectFetch({ app }), accessToken: () => ownerToken })
    const token = await fixture.mint({ id: AUTH_TEST_IDS.pending })
    const member = createApiClient({ fetch: injectFetch({ app }), accessToken: () => token })
    expect((await member.getMe()).status).toBe(MEMBER_STATUSES.pending)
    await client.setMemberStatus({
      id: AUTH_TEST_IDS.pending,
      change: { status: MEMBER_STATUSES.approved },
    })
    expect((await member.getMe()).status).toBe(MEMBER_STATUSES.approved)
    await client.setMemberStatus({
      id: AUTH_TEST_IDS.pending,
      change: { status: MEMBER_STATUSES.revoked },
    })
    expect((await member.getMe()).status).toBe(MEMBER_STATUSES.revoked)
  })

  it('rejects malformed account changes, missing users and owner removal', async () => {
    type SendProps = { id: string; status: string }

    const send = ({ id, status }: SendProps) =>
      app.inject({
        method: AUTH_METHODS.post,
        url: accountPath({ path: AUTH_PATHS.memberStatus, id }),
        headers: bearerHeaders({ token: ownerToken }),
        payload: { status },
      })
    expect((await send({ id: 'invalid', status: MEMBER_STATUSES.approved })).statusCode).toBe(400)
    expect(
      (await send({ id: AUTH_TEST_IDS.friend, status: MEMBER_STATUSES.pending })).statusCode,
    ).toBe(400)
    expect(
      (await send({ id: AUTH_TEST_IDS.missing, status: MEMBER_STATUSES.approved })).statusCode,
    ).toBe(404)
    expect(
      (await send({ id: AUTH_TEST_IDS.owner, status: MEMBER_STATUSES.revoked })).statusCode,
    ).toBe(403)
  })

  it.each([
    AUTH_TEST_FAILURES.network,
    AUTH_TEST_FAILURES.malformed,
    AUTH_TEST_FAILURES.wrongAccount,
    AUTH_TEST_FAILURES.ambiguous,
  ])('fails closed on unavailable or untrusted membership data: %s', async (failure) => {
    fixture.state.failure = failure
    const response = await app.inject({
      url: AUTH_PATHS.me,
      headers: bearerHeaders({ token: friendToken }),
    })
    expect(response.statusCode).toBe(503)
    expect(response.json()).toMatchObject({ reason: AUTH_REFUSALS.unavailable })
    expect(response.body).not.toContain(friendToken)
  })

  it('maps a backend session refusal to signed out', async () => {
    fixture.state.failure = AUTH_TEST_FAILURES.denied
    const response = await app.inject({
      url: AUTH_PATHS.me,
      headers: bearerHeaders({ token: friendToken }),
    })
    expect(response.statusCode).toBe(401)
  })
})

describe('account-bound playback tickets', () => {
  const client = () =>
    createApiClient({ fetch: injectFetch({ app }), accessToken: () => friendToken })

  it('issues an opaque ticket with no configured media secret and plays range requests', async () => {
    const result = await client().getAccountMediaTicket({ id: video })
    expect(result.ticket.startsWith(ACCOUNT_TICKET_PREFIX)).toBe(true)
    expect(result.ticket).not.toContain(friendToken)
    const response = await app.inject({
      url: withTicket({ route: ROUTES.file, params: { id: video }, ticket: result.ticket }),
      headers: { [HEADERS.range]: 'bytes=0-31' },
    })
    expect(response.statusCode).toBe(206)
    expect(response.rawPayload.byteLength).toBe(32)
    expect(result.expiresAt).toBeLessThanOrEqual(Date.now() + 300_000)
  })

  it('checks current approval on every redemption, without legacy-ticket fallback', async () => {
    const result = await client().getAccountMediaTicket({ id: video })
    const friend = fixture.accounts[AUTH_TEST_IDS.friend]
    if (friend === undefined) throw new Error('Missing friend')
    fixture.accounts[AUTH_TEST_IDS.friend] = { ...friend, status: MEMBER_STATUSES.revoked }
    const response = await app.inject({
      url: withTicket({ route: ROUTES.file, params: { id: video }, ticket: result.ticket }),
    })
    expect(response.statusCode).toBe(403)
    expect(response.json()).toMatchObject({ reason: AUTH_REFUSALS.revoked })
  })

  it('never downgrades an invalid account ticket to public legacy access', async () => {
    const response = await app.inject({
      url: withTicket({
        route: ROUTES.file,
        params: { id: video },
        ticket: `${ACCOUNT_TICKET_PREFIX}unknown`,
      }),
    })
    expect(response.statusCode).toBe(401)
  })

  it('refuses an account ticket for another media id', async () => {
    const result = await client().getAccountMediaTicket({ id: video })
    expect(
      (
        await app.inject({
          url: withTicket({ route: ROUTES.file, params: { id: video + 1 }, ticket: result.ticket }),
        })
      ).statusCode,
    ).toBe(401)
  })

  it('validates media route parameters before redeeming a capability', async () => {
    const result = await client().getAccountMediaTicket({ id: video })
    await Promise.all(
      ['NaN', '-1', '1.5', '9007199254740992'].map(async (id) => {
        expect(
          (
            await app.inject({
              url: withTicket({ route: ROUTES.file, params: { id }, ticket: result.ticket }),
            })
          ).statusCode,
        ).toBe(401)
      }),
    )
  })

  it('refuses pending, revoked, anonymous and cookie-only ticket issuance', async () => {
    const url = accountPath({ path: AUTH_PATHS.ticket, id: video })
    expect((await app.inject({ method: AUTH_METHODS.post, url })).statusCode).toBe(401)
    expect(
      (
        await app.inject({
          method: AUTH_METHODS.post,
          url,
          headers: { cookie: authCookie({ token: friendToken }) },
        })
      ).statusCode,
    ).toBe(401)
    await Promise.all(
      [AUTH_TEST_IDS.pending, AUTH_TEST_IDS.revoked].map(async (id) => {
        expect(
          (
            await app.inject({
              method: AUTH_METHODS.post,
              url,
              headers: bearerHeaders({ token: await fixture.mint({ id }) }),
            })
          ).statusCode,
        ).toBe(403)
      }),
    )
    expect(
      (
        await app.inject({
          method: AUTH_METHODS.post,
          url: accountPath({ path: AUTH_PATHS.ticket, id: 999999 }),
          headers: bearerHeaders({ token: friendToken }),
        })
      ).statusCode,
    ).toBe(404)
  })

  it('expires at the earlier of five minutes and the JWT expiry', async () => {
    const token = await fixture.mint({ expiresIn: 60 })
    const session = await app.get(AuthSessions).authenticate({ token })
    const request = { headers: bearerHeaders({ token }) }
    app.get(AuthSessions).bindSession({ request, session, isBearer: true })
    const result = app.get(AccountTickets).issue({ id: video, request })
    expect(isMediaTicket(result)).toBe(true)
    expect(result.expiresAt).toBe(session.expiresAt)
    await expect(
      app.get(AccountTickets).redeem({ id: video, ticket: result.ticket, now: result.expiresAt }),
    ).resolves.toBeNull()
  })

  it('grants a ticket for a locked library to the owner only once the PIN is entered, and never to a member', async () => {
    const path = join(root, 'private')
    await encodeClip({ path: join(path, 'Private.Auth.Test.2026.mp4') })
    const input = { name: 'Locked auth test', paths: [path] }
    const library = await manager.createLibrary(input)
    await app.get(ScannerService).whenIdle(library.id)
    const first = (await manager.listMedia({ libraryId: library.id }))[0]
    if (first === undefined) throw new Error('Missing private video')
    await manager.updateLibrary({ id: library.id, input: { ...input, settings: { locked: true } } })
    const url = accountPath({ path: AUTH_PATHS.ticket, id: first.id })
    type MintProps = { headers: Record<string, string> }

    const mint = ({ headers }: MintProps) => app.inject({ method: AUTH_METHODS.post, url, headers })
    const owner = bearerHeaders({ token: ownerToken })
    expect((await mint({ headers: bearerHeaders({ token: friendToken }) })).statusCode).toBe(404)
    expect((await mint({ headers: owner })).statusCode).toBe(LOCKED_STATUS)
    const unlocked = await app.inject({
      method: ROUTES.unlock.method,
      url: ROUTES.unlock.path,
      headers: owner,
      payload: { pin: LIBRARY_PIN },
    })
    expect(unlocked.statusCode).toBe(200)
    const issued = await mint({ headers: { ...owner, [AUTH_HEADERS.cookie]: cookieSet(unlocked) } })
    expect(issued.statusCode).toBe(200)
    const ticket: unknown = issued.json()
    if (!isMediaTicket(ticket)) throw new Error('Missing private ticket')
    expect(
      (
        await app.inject({
          url: withTicket({ route: ROUTES.file, params: { id: first.id }, ticket: ticket.ticket }),
        })
      ).statusCode,
    ).toBe(200)
  })
})

it('keeps health available but new account endpoints closed when configuration is absent', async () => {
  const unconfigured = await createApp({
    config: {
      ...testConfig({ dataDir: join(root, 'off'), mediaDir: root }),
      auth: readServerConfig({}).auth,
    },
    quiet: true,
    watch: NOT_WATCHING,
  })
  try {
    await unconfigured.init()
    expect((await unconfigured.inject({ url: ROUTES.health.path })).statusCode).toBe(200)
    expect((await unconfigured.inject({ url: AUTH_PATHS.me })).statusCode).toBe(503)
    // An unmarked route passes as the legacy browser, with no credentials and no account headers.
    const libraries = await unconfigured.inject({ url: ROUTES.libraries.path })
    expect(libraries.statusCode).toBe(200)
    expect(String(libraries.headers[HEADERS.vary] ?? '')).not.toContain(AUTH_HEADERS.authorization)
    expect(libraries.headers[HEADERS.cacheControl]).not.toBe(CACHE_POLICIES.noStore)
  } finally {
    await unconfigured.close()
  }
})

describe('a server that enforced accounts', () => {
  type StartProps = {
    dataDir: string
    auth: ServerConfig['auth']
    isOptedOut?: boolean
  }

  const start = ({ dataDir, auth, isOptedOut = false }: StartProps) =>
    createApp({
      config: {
        ...testConfig({ dataDir, mediaDir: root }),
        auth,
        isAccountsOptedOut: isOptedOut,
      },
      authKeys: fixture.keys,
      authFetch: fixture.fetcher,
      quiet: true,
      watch: NOT_WATCHING,
    })

  type AnswersProps = { server: NestFastifyApplication }

  const answers = async ({ server }: AnswersProps) => {
    await server.init()
    const [config, health, me, libraries] = await Promise.all(
      [AUTH_PATHS.config, ROUTES.health.path, AUTH_PATHS.me, ROUTES.libraries.path].map(
        async (url) => {
          const response = await server.inject({ url })
          return { status: response.statusCode, body: response.json() }
        },
      ),
    )
    return { config, health, me, libraries }
  }

  it('fails closed once its Supabase settings are gone, until the operator opts out', async () => {
    const dataDir = join(root, 'enforced')
    const ready = await start({ dataDir, auth: AUTH_TEST_CONFIG })
    try {
      await ready.init()
      expect(ready.get(SettingsRepository).accountsEnforcedAt()).not.toBeNull()
    } finally {
      await ready.close()
    }

    const gone = await start({ dataDir, auth: { state: AUTH_CONFIG_STATES.off } })
    try {
      const { config, health, me, libraries } = await answers({ server: gone })
      expect(config).toEqual({
        status: 200,
        body: { state: AUTH_CONFIG_STATES.unavailable },
      })
      expect(health.status).toBe(200)
      expect(me).toMatchObject({ status: 503, body: { reason: AUTH_REFUSALS.unavailable } })
      expect(libraries).toMatchObject({
        status: 503,
        body: { reason: AUTH_REFUSALS.unavailable },
      })
      expect(gone.get(SettingsRepository).accountsEnforcedAt()).not.toBeNull()
    } finally {
      await gone.close()
    }

    const optedOut = await start({
      dataDir,
      auth: { state: AUTH_CONFIG_STATES.off },
      isOptedOut: true,
    })
    try {
      const { config, health, libraries } = await answers({ server: optedOut })
      expect(config).toEqual({ status: 200, body: { state: AUTH_CONFIG_STATES.off } })
      expect(health.status).toBe(200)
      expect(libraries.status).toBe(200)
      expect(optedOut.get(SettingsRepository).accountsEnforcedAt()).toBeNull()
    } finally {
      await optedOut.close()
    }

    const forgotten = await start({ dataDir, auth: { state: AUTH_CONFIG_STATES.off } })
    try {
      const { config, libraries } = await answers({ server: forgotten })
      expect(config.body).toEqual({ state: AUTH_CONFIG_STATES.off })
      expect(libraries.status).toBe(200)
    } finally {
      await forgotten.close()
    }
  })

  it('keeps the first date it enforced on later ready starts', async () => {
    const dataDir = join(root, 'dated')
    const first = await start({ dataDir, auth: AUTH_TEST_CONFIG })
    const enforcedAt = await first
      .init()
      .then(() => first.get(SettingsRepository).accountsEnforcedAt())
    await first.close()
    const second = await start({ dataDir, auth: AUTH_TEST_CONFIG })
    try {
      await second.init()
      expect(second.get(SettingsRepository).accountsEnforcedAt()).toBe(enforcedAt)
    } finally {
      await second.close()
    }
  })

  it('treats the opt-out together with Supabase settings as a conflict that stays closed', async () => {
    const conflict = await start({
      dataDir: join(root, 'conflict'),
      auth: AUTH_TEST_CONFIG,
      isOptedOut: true,
    })
    try {
      const { config, health, me } = await answers({ server: conflict })
      expect(config.body).toEqual({ state: AUTH_CONFIG_STATES.unavailable })
      expect(health.status).toBe(200)
      expect(me.status).toBe(503)
      expect(conflict.get(SettingsRepository).accountsEnforcedAt()).toBeNull()
    } finally {
      await conflict.close()
    }
  })
})
