import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import {
  AUTH_COOKIE,
  AUTH_HEADERS,
  AUTH_METHODS,
  AUTH_PARAMS,
  AUTH_PATHS,
  AUTH_REFUSALS,
  AUTH_SCHEME,
  MEMBER_STATUSES,
  createApiClient,
  isMediaTicket,
} from '@raven/core'
import { CACHE_POLICIES, HEADERS } from '@shared/server'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '@/app'
import { AUTH_ENCODINGS } from '@/auth/accessToken'
import { ACCOUNT_TICKET_PREFIX, AccountTickets } from '@/auth/accountTickets'
import { AuthSessions } from '@/auth/authSessions'
import { readServerConfig } from '@/config'
import { ScannerService } from '@/scanner/scannerService'
import { AUTH_TEST_CONFIG, AUTH_TEST_FAILURES, AUTH_TEST_IDS, authFixture } from '@/test/auth'
import { NOT_WATCHING, adminCookie, cookieSet, testConfig } from '@/test/app'
import { encodeClip } from '@/test/clips'
import { apiFor, injectFetch } from '@/test/server'

const accountPath = ({ path, id }: { path: string; id: string | number }) =>
  path.replace(`:${AUTH_PARAMS.id}`, String(id))
const bearer = (token: string) => ({ [AUTH_HEADERS.authorization]: `${AUTH_SCHEME} ${token}` })
const cookie = (token: string) =>
  `${AUTH_COOKIE}=base64-${Buffer.from(JSON.stringify({ access_token: token })).toString(AUTH_ENCODINGS.base64url)}`

let app: NestFastifyApplication
let root: string
let fixture: Awaited<ReturnType<typeof authFixture>>
let video: number
let admin: string
let friendToken: string
let ownerToken: string

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'raven-auth-'))
  const mediaDir = join(root, 'media')
  await encodeClip({ path: join(mediaDir, 'Auth.Test.2026.mp4') })
  fixture = await authFixture()
  app = await createApp({
    config: {
      ...testConfig({ dataDir: join(root, 'data'), mediaDir }),
      auth: AUTH_TEST_CONFIG,
      libraryPin: '3001',
    },
    authKeys: fixture.keys,
    authFetch: fixture.fetcher,
    quiet: true,
    watch: NOT_WATCHING,
  })
  await app.init()
  await app.getHttpAdapter().getInstance().ready()
  admin = await adminCookie(app)
  const library = await apiFor({ app, cookie: admin }).createLibrary({
    name: 'Auth test',
    paths: [mediaDir],
  })
  await app.get(ScannerService).whenIdle(library.id)
  const first = (await apiFor({ app }).listMedia({ libraryId: library.id }))[0]
  if (first === undefined) throw new Error('Missing test video')
  video = first.id
  friendToken = await fixture.mint()
  ownerToken = await fixture.mint({ id: AUTH_TEST_IDS.owner })
})

afterAll(async () => {
  await app.close()
  await rm(root, { recursive: true, force: true })
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

describe('new account endpoints, before the library cutover', () => {
  it('publishes only safe auth config without a session', async () => {
    const response = await app.inject({ url: AUTH_PATHS.config })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(AUTH_TEST_CONFIG)
    expect(response.headers[HEADERS.cacheControl]).toBe(CACHE_POLICIES.noStore)
    expect(fixture.fetcher).not.toHaveBeenCalled()
  })

  it('does not change existing anonymous library access or health', async () => {
    const responses = await Promise.all(
      ['/api/health', '/api/libraries'].map((url) => app.inject({ url })),
    )
    expect(responses.map(({ statusCode }) => statusCode)).toEqual([200, 200])
    expect(fixture.fetcher).not.toHaveBeenCalled()
  })

  it('requires real identity, not the old admin cookie', async () => {
    const response = await app.inject({ url: AUTH_PATHS.members, headers: { cookie: admin } })
    expect(response.statusCode).toBe(401)
    expect(response.json()).toMatchObject({ reason: AUTH_REFUSALS.signedOut })
  })

  it('returns the current account for Bearer or a read-only browser cookie', async () => {
    const client = createApiClient({ fetch: injectFetch({ app }), accessToken: () => friendToken })
    expect(await client.getMe()).toEqual(fixture.accounts[AUTH_TEST_IDS.friend])
    const response = await app.inject({
      url: AUTH_PATHS.me,
      headers: { cookie: cookie(friendToken) },
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
          headers: bearer(await fixture.mint({ id })),
        })
        expect(response.statusCode).toBe(200)
        expect(response.json()).toEqual(fixture.accounts[id])
      }),
    )
  })

  it('refuses a missing membership instead of inventing an approved account', async () => {
    const response = await app.inject({
      url: AUTH_PATHS.me,
      headers: bearer(await fixture.mint({ id: AUTH_TEST_IDS.missing })),
    })
    expect(response.statusCode).toBe(403)
    expect(response.json()).toMatchObject({ reason: AUTH_REFUSALS.pending })
  })

  it('refuses bad Bearer even when a valid owner cookie is also present', async () => {
    const response = await app.inject({
      url: AUTH_PATHS.members,
      headers: { ...bearer('not-a-jwt'), cookie: cookie(ownerToken) },
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
    const response = await app.inject({ url: AUTH_PATHS.members, headers: bearer(token) })
    expect(response.statusCode).toBe(403)
    expect(response.json()).toMatchObject({ reason: AUTH_REFUSALS.notOwner })
  })

  it('allows only the approved owner to list members, with bounded pagination', async () => {
    const client = createApiClient({ fetch: injectFetch({ app }), accessToken: () => ownerToken })
    expect(await client.listMembers({ pageSize: 1, pageOffset: 1 })).toHaveLength(1)
    const invalid = await app.inject({
      url: `${AUTH_PATHS.members}?${AUTH_PARAMS.pageSize}=101`,
      headers: bearer(ownerToken),
    })
    expect(invalid.statusCode).toBe(400)
    await Promise.all(
      [AUTH_TEST_IDS.friend, AUTH_TEST_IDS.pending, AUTH_TEST_IDS.revoked].map(async (id) => {
        const response = await app.inject({
          url: AUTH_PATHS.members,
          headers: bearer(await fixture.mint({ id })),
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
          (await app.inject({ url: `${AUTH_PATHS.members}?${query}`, headers: bearer(ownerToken) }))
            .statusCode,
        ).toBe(400)
      }),
    )
  })

  it('requires Bearer for approval writes, not a readable session cookie', async () => {
    const response = await app.inject({
      method: AUTH_METHODS.post,
      url: accountPath({ path: AUTH_PATHS.memberStatus, id: AUTH_TEST_IDS.pending }),
      headers: { cookie: cookie(ownerToken) },
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
    const send = ({ id, status }: { id: string; status: string }) =>
      app.inject({
        method: AUTH_METHODS.post,
        url: accountPath({ path: AUTH_PATHS.memberStatus, id }),
        headers: bearer(ownerToken),
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
  ])('fails closed on unavailable or untrusted membership data: %s', async (failure) => {
    fixture.state.failure = failure
    const response = await app.inject({ url: AUTH_PATHS.me, headers: bearer(friendToken) })
    expect(response.statusCode).toBe(503)
    expect(response.json()).toMatchObject({ reason: AUTH_REFUSALS.unavailable })
    expect(response.body).not.toContain(friendToken)
  })

  it('maps a backend session refusal to signed out', async () => {
    fixture.state.failure = AUTH_TEST_FAILURES.denied
    const response = await app.inject({ url: AUTH_PATHS.me, headers: bearer(friendToken) })
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
      url: `/api/media/${video}/file?t=${result.ticket}`,
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
    const response = await app.inject({ url: `/api/media/${video}/file?t=${result.ticket}` })
    expect(response.statusCode).toBe(403)
    expect(response.json()).toMatchObject({ reason: AUTH_REFUSALS.revoked })
  })

  it('never downgrades an invalid account ticket to public legacy access', async () => {
    const response = await app.inject({
      url: `/api/media/${video}/file?t=${ACCOUNT_TICKET_PREFIX}unknown`,
    })
    expect(response.statusCode).toBe(401)
  })

  it('refuses an account ticket for another media id', async () => {
    const result = await client().getAccountMediaTicket({ id: video })
    expect(
      (await app.inject({ url: `/api/media/${video + 1}/file?t=${result.ticket}` })).statusCode,
    ).toBe(401)
  })

  it('validates media route parameters before redeeming a capability', async () => {
    const result = await client().getAccountMediaTicket({ id: video })
    await Promise.all(
      ['NaN', '-1', '1.5', '9007199254740992'].map(async (id) => {
        expect(
          (await app.inject({ url: `/api/media/${id}/file?t=${result.ticket}` })).statusCode,
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
          headers: { cookie: cookie(friendToken) },
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
              headers: bearer(await fixture.mint({ id })),
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
          headers: bearer(friendToken),
        })
      ).statusCode,
    ).toBe(404)
  })

  it('expires at the earlier of five minutes and the JWT expiry', async () => {
    const token = await fixture.mint({ expiresIn: 60 })
    const session = await app.get(AuthSessions).authenticate({ token })
    const result = app.get(AccountTickets).issue({ id: video, session })
    expect(isMediaTicket(result)).toBe(true)
    expect(result.expiresAt).toBe(session.expiresAt)
    await expect(
      app.get(AccountTickets).redeem({ id: video, ticket: result.ticket, now: result.expiresAt }),
    ).rejects.toMatchObject({ response: { reason: AUTH_REFUSALS.signedOut } })
  })

  it('does not grant a ticket for a locked library without the existing PIN authorization', async () => {
    const path = join(root, 'private')
    await encodeClip({ path: join(path, 'Private.Auth.Test.2026.mp4') })
    const manager = apiFor({ app, cookie: admin })
    const input = { name: 'Locked auth test', paths: [path] }
    const library = await manager.createLibrary(input)
    await app.get(ScannerService).whenIdle(library.id)
    const first = (await manager.listMedia({ libraryId: library.id }))[0]
    if (first === undefined) throw new Error('Missing private video')
    await manager.updateLibrary({ id: library.id, input: { ...input, settings: { locked: true } } })
    const url = accountPath({ path: AUTH_PATHS.ticket, id: first.id })
    expect(
      (await app.inject({ method: AUTH_METHODS.post, url, headers: bearer(friendToken) }))
        .statusCode,
    ).toBe(404)
    expect(
      (
        await app.inject({
          method: AUTH_METHODS.post,
          url,
          headers: { ...bearer(ownerToken), cookie: admin },
        })
      ).statusCode,
    ).toBe(423)
    const unlocked = await app.inject({
      method: AUTH_METHODS.post,
      url: '/api/lock/unlock',
      headers: { cookie: admin },
      payload: { pin: '3001' },
    })
    const issued = await app.inject({
      method: AUTH_METHODS.post,
      url,
      headers: { ...bearer(ownerToken), cookie: `${admin}; ${cookieSet(unlocked)}` },
    })
    expect(issued.statusCode).toBe(200)
    const ticket: unknown = issued.json()
    if (!isMediaTicket(ticket)) throw new Error('Missing private ticket')
    expect(
      (await app.inject({ url: `/api/media/${first.id}/file?t=${ticket.ticket}` })).statusCode,
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
    expect((await unconfigured.inject({ url: '/api/health' })).statusCode).toBe(200)
    expect((await unconfigured.inject({ url: AUTH_PATHS.me })).statusCode).toBe(503)
  } finally {
    await unconfigured.close()
  }
})
