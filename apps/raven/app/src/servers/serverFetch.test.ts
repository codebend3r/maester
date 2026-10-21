import { describe, expect, it } from 'bun:test'
import { ADMIN_LOCK_STATES, AUTH_HEADERS, SERVER_COOKIES, createApiClient } from '@raven/core'

import { type CookieJar, cookieKeyFor, createCookieJar } from '@/servers/cookieJar'
import {
  FETCH_CREDENTIALS,
  type NativeFetch,
  RESPONSE_HEADERS,
  serverFetchFor,
} from '@/servers/serverFetch'
import type { AppServer } from '@/servers/serverList'
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

const jarWith = (stored: Record<string, string> | null): CookieJar =>
  createCookieJar({
    store: memoryStore(stored === null ? [] : [[cookieKeyFor(SERVER.id), JSON.stringify(stored)]])
      .store,
  })

describe('serverFetchFor', () => {
  it("sends the server's cookies, and never the system's", async () => {
    const { fetch, sent } = recordingFetch()
    const jar = jarWith({ [SERVER_COOKIES.unlock]: 'abc', [SERVER_COOKIES.admin]: 'def' })
    const serverFetch = serverFetchFor({ server: SERVER, jar, fetch })
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
    await serverFetchFor({ server: SERVER, jar: jarWith(null), fetch })('http://nas:8080/api/lock')
    expect(sent.map(({ init }) => init)).toEqual([{ credentials: FETCH_CREDENTIALS.omit }])
  })

  it("keeps the cookies off any address outside the server's API", async () => {
    const { fetch, sent } = recordingFetch()
    const serverFetch = serverFetchFor({
      server: SERVER,
      jar: jarWith({ [SERVER_COOKIES.unlock]: 'a' }),
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
      fetch: serverFetchFor({ server: SERVER, jar, fetch: unlocking.fetch }),
    }).unlock('1234')
    const admitting = recordingFetch({
      setCookie: 'raven_admin=1.2.xy; Path=/api; HttpOnly; SameSite=Strict; Max-Age=34560000',
      body: { state: ADMIN_LOCK_STATES.off },
    })
    const api = createApiClient({
      baseUrl: SERVER.origin,
      fetch: serverFetchFor({ server: SERVER, jar, fetch: admitting.fetch }),
    })
    await api.unlockAdmin('Pass#word2026')
    await api.getAdminLock()
    expect(unlocking.sent.map(({ init }) => init.body)).toEqual(['{"pin":"1234"}'])
    expect(admitting.sent.map(({ url, init }) => [url, init.headers?.cookie ?? null])).toEqual([
      ['http://nas:8080/api/admin/unlock', 'raven_unlock=1760000000000.Ab-_9z'],
      ['http://nas:8080/api/admin', 'raven_unlock=1760000000000.Ab-_9z; raven_admin=1.2.xy'],
    ])
  })

  it('forgets a cookie the server clears with Max-Age=0', async () => {
    const jar = jarWith({ [SERVER_COOKIES.unlock]: 'a', [SERVER_COOKIES.admin]: 'b' })
    const { fetch } = recordingFetch({ setCookie: 'raven_unlock=; Max-Age=0; Path=/api' })
    await serverFetchFor({ server: SERVER, jar, fetch })('http://nas:8080/api/lock/lock')
    expect(await jar.read(SERVER.id)).toEqual({ [SERVER_COOKIES.admin]: 'b' })
  })

  it("ignores a set-cookie from outside the server's API", async () => {
    const jar = jarWith(null)
    const { fetch } = recordingFetch({ setCookie: 'raven_unlock=forged; Path=/api' })
    await serverFetchFor({ server: SERVER, jar, fetch })('https://media.example/api/x')
    expect(await jar.read(SERVER.id)).toEqual({})
  })

  it("ignores a set-cookie from a response a redirect took off the server's API", async () => {
    const jar = jarWith(null)
    const { fetch } = recordingFetch({
      setCookie: 'raven_unlock=forged; Path=/api',
      landedAt: 'https://elsewhere.example/api/lock',
    })
    await serverFetchFor({ server: SERVER, jar, fetch })('http://nas:8080/api/lock')
    expect(await jar.read(SERVER.id)).toEqual({})
  })

  it('reads the request address when the response reports none', async () => {
    const jar = jarWith(null)
    const { fetch } = recordingFetch({ setCookie: 'raven_unlock=abc; Path=/api', landedAt: '' })
    await serverFetchFor({ server: SERVER, jar, fetch })('http://nas:8080/api/lock/unlock')
    expect(await jar.read(SERVER.id)).toEqual({ [SERVER_COOKIES.unlock]: 'abc' })
  })

  it('keeps the cookies it has when a response sets none', async () => {
    const jar = jarWith({ [SERVER_COOKIES.unlock]: 'abc' })
    const { fetch } = recordingFetch()
    await serverFetchFor({ server: SERVER, jar, fetch })('http://nas:8080/api/home')
    expect(await jar.read(SERVER.id)).toEqual({ [SERVER_COOKIES.unlock]: 'abc' })
  })
})
