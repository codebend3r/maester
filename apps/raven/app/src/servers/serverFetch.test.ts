import { describe, expect, it } from 'bun:test'
import {
  ADMIN_LOCK_STATES,
  AUTH_HEADERS,
  AUTH_REFUSALS,
  AUTH_SCHEME,
  ApiError,
  SERVER_COOKIES,
  createApiClient,
} from '@raven/core'

import { accountBearer, createAccountSessions } from '@/accounts/accountSessions'
import { createSessionStore } from '@/accounts/sessionStore'
import { type CookieJar, cookieKeyFor, createCookieJar } from '@/servers/cookieJar'
import {
  FETCH_CREDENTIALS,
  type NativeFetch,
  RESPONSE_HEADERS,
  type ServerBearer,
  serverFetchFor,
} from '@/servers/serverFetch'
import type { AppServer } from '@/servers/serverList'
import { PIN } from '@/test/accountPins'
import { ACCOUNT, accessTokenOf, stubAuth } from '@/test/authStub'
import { STATUSES, responseOf } from '@/test/fixtureFetch'
import { memoryStore } from '@/test/memoryStore'

const SERVER: AppServer = {
  id: '0f8fad5b-d9cb-469f-a165-70867728950e',
  name: 'nas:8080',
  origin: 'http://nas:8080',
  addedAt: 1,
  account: null,
}

type Sent = { url: string; init: Parameters<NativeFetch>[1] }

/**
 * A fetch that records each request and answers with `setCookie` and `body`, reporting
 * `landedAt` as where the request ended (the request's own address unless set).
 */
const recordingFetch = ({
  setCookie = null,
  body = { available: true, unlocked: true },
  landedAt,
}: { setCookie?: string | null; body?: unknown; landedAt?: string } = {}) => {
  const sent: Sent[] = []
  const fetch: NativeFetch = async (url, init) => {
    sent.push({ url, init })
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      url: landedAt ?? url,
      json: async () => body,
      text: async () => JSON.stringify(body),
      headers: { get: (name) => (name === RESPONSE_HEADERS.setCookie ? setCookie : null) },
    }
  }
  return { fetch, sent }
}

/** For a server without accounts: no token, and so nothing to refresh. */
const NO_BEARER: ServerBearer = {
  token: async () => null,
  refresh: async () => null,
  rejected: async () => {},
}

/**
 * A sign-in whose token is `token`, whose refreshes hand out `refreshed` in turn (null once they
 * run out), and which counts its refreshes and rejections.
 */
const bearerWith = ({
  token,
  refreshed = [],
}: {
  token: string
  refreshed?: (string | null)[]
}) => {
  const state = { token, refreshes: 0, rejections: 0 }
  const bearer: ServerBearer = {
    token: async () => state.token,
    refresh: async () => {
      const next = refreshed[state.refreshes] ?? null
      state.refreshes += 1
      if (next !== null) state.token = next
      return next
    },
    rejected: async () => {
      state.rejections += 1
    },
  }
  return { ...bearer, state }
}

const SIGNED_OUT = { reason: AUTH_REFUSALS.signedOut, message: 'Sign in to use raven.' }

/** A fetch that answers each request with the next of `answers`, recording what it was sent. */
const scriptedFetch = (answers: { status: number; body: unknown }[]) => {
  const sent: Sent[] = []
  const fetch: NativeFetch = async (url, init) => {
    const { status, body } = answers[sent.length] ?? { status: STATUSES.ok, body: UNLOCKED }
    sent.push({ url, init })
    return { ...responseOf({ status, body }), url, headers: { get: () => null } }
  }
  const authorizations = () =>
    sent.map(({ init }) => init.headers?.[AUTH_HEADERS.authorization] ?? null)
  return { fetch, sent, authorizations }
}

/** The PIN lock as a server with nothing locked answers it. */
const UNLOCKED = { available: true, unlocked: true }

const bearerOf = (token: string): string => `${AUTH_SCHEME} ${token}`

const jarWith = (stored: Record<string, string> | null): CookieJar =>
  createCookieJar({
    store: memoryStore(stored === null ? [] : [[cookieKeyFor(SERVER.id), JSON.stringify(stored)]])
      .store,
  })

describe('serverFetchFor', () => {
  it("sends the server's cookies, and never the system's", async () => {
    const { fetch, sent } = recordingFetch()
    const jar = jarWith({ [SERVER_COOKIES.unlock]: 'abc', [SERVER_COOKIES.admin]: 'def' })
    const serverFetch = serverFetchFor({ server: SERVER, jar, bearer: NO_BEARER, fetch })
    await serverFetch('http://nas:8080/api/home', { headers: { accept: 'application/json' } })
    expect(sent).toEqual([
      {
        url: 'http://nas:8080/api/home',
        init: {
          headers: {
            accept: 'application/json',
            [AUTH_HEADERS.cookie]: 'raven_unlock=abc; raven_admin=def',
          },
          credentials: FETCH_CREDENTIALS.omit,
        },
      },
    ])
    expect(FETCH_CREDENTIALS.omit).toBe('omit')
  })

  it('sends no cookie header when the jar has none', async () => {
    const { fetch, sent } = recordingFetch()
    await serverFetchFor({ server: SERVER, jar: jarWith(null), bearer: NO_BEARER, fetch })(
      'http://nas:8080/api/lock',
    )
    expect(sent.map(({ init }) => init)).toEqual([{ credentials: FETCH_CREDENTIALS.omit }])
  })

  it("keeps the cookies off any address outside the server's API", async () => {
    const { fetch, sent } = recordingFetch()
    const serverFetch = serverFetchFor({
      server: SERVER,
      jar: jarWith({ [SERVER_COOKIES.unlock]: 'a' }),
      bearer: bearerWith({ token: 'token-1' }),
      fetch,
    })
    await serverFetch('https://media.example/api/media-origins/ping?bytes=1')
    await serverFetch('http://nas:8080.evil/api/home')
    await serverFetch('http://nas:8080/thumbnails/1.jpg')
    expect(sent.map(({ init }) => init)).toEqual([
      { credentials: FETCH_CREDENTIALS.omit },
      { credentials: FETCH_CREDENTIALS.omit },
      { credentials: FETCH_CREDENTIALS.omit },
    ])
  })

  it('stores the cookies unlock and unlockAdmin set, and sends both next', async () => {
    const jar = jarWith(null)
    const unlocking = recordingFetch({
      setCookie: 'raven_unlock=1760000000000.Ab-_9z; Path=/api; HttpOnly; SameSite=Strict',
    })
    await createApiClient({
      baseUrl: SERVER.origin,
      fetch: serverFetchFor({ server: SERVER, jar, bearer: NO_BEARER, fetch: unlocking.fetch }),
    }).unlock('1234')
    const admitting = recordingFetch({
      setCookie: 'raven_admin=1.2.xy; Path=/api; HttpOnly; SameSite=Strict; Max-Age=34560000',
      body: { state: ADMIN_LOCK_STATES.off },
    })
    const api = createApiClient({
      baseUrl: SERVER.origin,
      fetch: serverFetchFor({ server: SERVER, jar, bearer: NO_BEARER, fetch: admitting.fetch }),
    })
    await api.unlockAdmin('Pass#word2026')
    await api.getAdminLock()
    expect(unlocking.sent.map(({ init }) => init.body)).toEqual(['{"pin":"1234"}'])
    expect(
      admitting.sent.map(({ url, init }) => [url, init.headers?.[AUTH_HEADERS.cookie] ?? null]),
    ).toEqual([
      ['http://nas:8080/api/admin/unlock', 'raven_unlock=1760000000000.Ab-_9z'],
      ['http://nas:8080/api/admin', 'raven_unlock=1760000000000.Ab-_9z; raven_admin=1.2.xy'],
    ])
  })

  it('forgets a cookie the server clears with Max-Age=0', async () => {
    const jar = jarWith({ [SERVER_COOKIES.unlock]: 'a', [SERVER_COOKIES.admin]: 'b' })
    const { fetch } = recordingFetch({ setCookie: 'raven_unlock=; Max-Age=0; Path=/api' })
    await serverFetchFor({ server: SERVER, jar, bearer: NO_BEARER, fetch })(
      'http://nas:8080/api/lock/lock',
    )
    expect(await jar.read(SERVER.id)).toEqual({ [SERVER_COOKIES.admin]: 'b' })
  })

  it("ignores a set-cookie from outside the server's API", async () => {
    const jar = jarWith(null)
    const { fetch } = recordingFetch({ setCookie: 'raven_unlock=forged; Path=/api' })
    await serverFetchFor({ server: SERVER, jar, bearer: NO_BEARER, fetch })(
      'https://media.example/api/x',
    )
    expect(await jar.read(SERVER.id)).toEqual({})
  })

  it("ignores a set-cookie from a response a redirect took off the server's API", async () => {
    const jar = jarWith(null)
    const { fetch } = recordingFetch({
      setCookie: 'raven_unlock=forged; Path=/api',
      landedAt: 'https://elsewhere.example/api/lock',
    })
    await serverFetchFor({ server: SERVER, jar, bearer: NO_BEARER, fetch })(
      'http://nas:8080/api/lock',
    )
    expect(await jar.read(SERVER.id)).toEqual({})
  })

  it('reads the request address when the response reports none', async () => {
    const jar = jarWith(null)
    const { fetch } = recordingFetch({ setCookie: 'raven_unlock=abc; Path=/api', landedAt: '' })
    await serverFetchFor({ server: SERVER, jar, bearer: NO_BEARER, fetch })(
      'http://nas:8080/api/lock/unlock',
    )
    expect(await jar.read(SERVER.id)).toEqual({ [SERVER_COOKIES.unlock]: 'abc' })
  })

  it('keeps the cookies it has when a response sets none', async () => {
    const jar = jarWith({ [SERVER_COOKIES.unlock]: 'abc' })
    const { fetch } = recordingFetch()
    await serverFetchFor({ server: SERVER, jar, bearer: NO_BEARER, fetch })(
      'http://nas:8080/api/home',
    )
    expect(await jar.read(SERVER.id)).toEqual({ [SERVER_COOKIES.unlock]: 'abc' })
  })

  describe('with an account', () => {
    const api = ({ bearer, fetch }: { bearer: ServerBearer; fetch: NativeFetch }) =>
      createApiClient({
        baseUrl: SERVER.origin,
        fetch: serverFetchFor({ server: SERVER, jar: jarWith(null), bearer, fetch }),
      })

    it("sends the account's Bearer beside the cookies to the server's own API alone", async () => {
      const { fetch, sent } = recordingFetch()
      const serverFetch = serverFetchFor({
        server: SERVER,
        jar: jarWith({ [SERVER_COOKIES.unlock]: 'abc' }),
        bearer: bearerWith({ token: 'token-1' }),
        fetch,
      })
      await serverFetch('http://nas:8080/api/home')
      await serverFetch('https://media.example/api/media-origins/ping?bytes=1')
      expect(sent.map(({ init }) => init.headers ?? {})).toEqual([
        {
          [AUTH_HEADERS.cookie]: `${SERVER_COOKIES.unlock}=abc`,
          [AUTH_HEADERS.authorization]: bearerOf('token-1'),
        },
        {},
      ])
    })

    it('keeps the session a sign-in made, and the next call carries its Bearer', async () => {
      const auth = stubAuth({ config: PIN })
      const sessions = createAccountSessions({
        store: createSessionStore({ store: memoryStore().store }),
        fetch: auth.fetch,
        onChange: () => {},
      })
      const server = { ...SERVER, account: PIN }
      await sessions.signIn({
        server,
        account: PIN,
        email: ACCOUNT.email,
        password: ACCOUNT.password,
      })
      const { fetch, authorizations } = scriptedFetch([])
      await api({
        bearer: accountBearer({ sessions, server, hasAccounts: () => true }),
        fetch,
      }).getLock()
      expect(authorizations()).toEqual([bearerOf(accessTokenOf(1))])
    })

    it('sends no Bearer while the server says it has no accounts', async () => {
      const auth = stubAuth({ config: PIN })
      const sessions = createAccountSessions({
        store: createSessionStore({ store: memoryStore().store }),
        fetch: auth.fetch,
        onChange: () => {},
      })
      const server = { ...SERVER, account: PIN }
      await sessions.signIn({
        server,
        account: PIN,
        email: ACCOUNT.email,
        password: ACCOUNT.password,
      })
      const { fetch, authorizations } = scriptedFetch([])
      await api({
        bearer: accountBearer({ sessions, server, hasAccounts: () => false }),
        fetch,
      }).getLock()
      expect(authorizations()).toEqual([null])
    })

    it('refreshes once on a signed_out refusal and sends the call again with the new token', async () => {
      const bearer = bearerWith({ token: 'token-1', refreshed: ['token-2'] })
      const { fetch, authorizations } = scriptedFetch([
        { status: STATUSES.unauthorized, body: SIGNED_OUT },
      ])
      await api({ bearer, fetch }).getLock()
      expect(authorizations()).toEqual([bearerOf('token-1'), bearerOf('token-2')])
      expect(bearer.state).toMatchObject({ refreshes: 1, rejections: 0 })
    })

    it('signs out when the refreshed token is refused as well, and hands the refusal on', async () => {
      const bearer = bearerWith({ token: 'token-1', refreshed: ['token-2', 'token-3'] })
      const { fetch, authorizations } = scriptedFetch([
        { status: STATUSES.unauthorized, body: SIGNED_OUT },
        { status: STATUSES.unauthorized, body: SIGNED_OUT },
      ])
      const error = await api({ bearer, fetch })
        .getLock()
        .catch((caught: unknown) => caught)
      expect(authorizations()).toEqual([bearerOf('token-1'), bearerOf('token-2')])
      expect(bearer.state).toMatchObject({ refreshes: 1, rejections: 1 })
      expect(error).toBeInstanceOf(ApiError)
      expect(error instanceof ApiError ? error.refusal : null).toEqual(SIGNED_OUT)
    })

    it('hands the refusal on, signed in still, when no fresh token comes', async () => {
      const bearer = bearerWith({ token: 'token-1', refreshed: [null] })
      const { fetch, sent } = scriptedFetch([{ status: STATUSES.unauthorized, body: SIGNED_OUT }])
      const error = await api({ bearer, fetch })
        .getLock()
        .catch((caught: unknown) => caught)
      expect(sent).toHaveLength(1)
      expect(bearer.state).toMatchObject({ refreshes: 1, rejections: 0 })
      expect(error instanceof ApiError ? error.refusal : null).toEqual(SIGNED_OUT)
    })

    it('refreshes for nothing but a signed_out refusal of a call that carried a token', async () => {
      const wrongPin = bearerWith({ token: 'token-1', refreshed: ['token-2'] })
      const refused = scriptedFetch([
        { status: STATUSES.unauthorized, body: { message: 'Wrong PIN' } },
      ])
      await api({ bearer: wrongPin, fetch: refused.fetch })
        .unlock('1234')
        .catch(() => undefined)
      const revoked = bearerWith({ token: 'token-1', refreshed: ['token-2'] })
      const forbidden = scriptedFetch([
        {
          status: STATUSES.forbidden,
          body: { reason: AUTH_REFUSALS.revoked, message: 'Access removed.' },
        },
      ])
      await api({ bearer: revoked, fetch: forbidden.fetch })
        .getLock()
        .catch(() => undefined)
      const { fetch, sent } = scriptedFetch([{ status: STATUSES.unauthorized, body: SIGNED_OUT }])
      await api({ bearer: NO_BEARER, fetch })
        .getLock()
        .catch(() => undefined)
      expect([refused.sent.length, forbidden.sent.length, sent.length]).toEqual([1, 1, 1])
      expect([wrongPin.state.refreshes, revoked.state.refreshes]).toEqual([0, 0])
    })
  })
})
