import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { HLS_PARAMS } from '@raven/core'
import { CACHE_POLICIES, HEADERS, TOO_MANY_REQUESTS } from '@shared/server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '@/app'
import { RAVEN_HEADERS } from '@/http'
import { RATE_LIMITS, RATE_TIERS } from '@/rateLimits/rateTiers'
import { type InjectOptions, NOT_WATCHING, ROUTE_METHODS, testConfig } from '@/test/app'
import { manualClock } from '@/test/clock'
import { RATE_ROUTES, ROUTES, type Route, pathOf } from '@/test/enforced'

const STRICT = RATE_LIMITS[RATE_TIERS.strict].limit
const STANDARD = RATE_LIMITS[RATE_TIERS.standard].limit
const MEDIA = RATE_LIMITS[RATE_TIERS.media].limit
const WINDOW_MS = RATE_LIMITS[RATE_TIERS.strict].windowMs

/** The NAS's reverse proxy, on Docker's bridge, as raven's socket sees it. */
const PROXY = '172.17.0.1'
const HOME = '192.168.1.20'

/** A public address of its own for each test, so no test spends another's budget. */
const away = (n: number): string => `198.51.100.${n}`

const ECHO = pathOf({ route: ROUTES.remoteAccessEcho, params: { nonce: 'AAAAAAAAAAAAAAAAAAAAAA' } })

describe('rate limits', () => {
  const state: { root: string; app: NestFastifyApplication | null } = { root: '', app: null }
  const timing = manualClock()
  const app = (): NestFastifyApplication => {
    if (!state.app) throw new Error('app not started')
    return state.app
  }

  beforeAll(async () => {
    state.root = await mkdtemp(join(tmpdir(), 'raven-rate-limits-'))
    state.app = await createApp({
      config: testConfig({ dataDir: join(state.root, 'data'), mediaDir: state.root }),
      quiet: true,
      watch: NOT_WATCHING,
      clock: timing.clock,
    })
    await state.app.init()
  })

  afterAll(async () => {
    await state.app?.close()
    await rm(state.root, { recursive: true, force: true, maxRetries: 5 })
  })

  type SendProps = { options: InjectOptions; times: number }

  /** Each response's status, sent one after another so they are counted in order. */
  const statuses = async ({ options, times }: SendProps): Promise<number[]> =>
    Array.from({ length: times }).reduce<Promise<number[]>>(async (sent) => {
      const before = await sent
      const response = await app().inject(options)
      return [...before, response.statusCode]
    }, Promise.resolve([]))

  /** Each response's status, sent all at once, for a run whose order does not matter. */
  const allStatuses = async ({ options, times }: SendProps): Promise<number[]> =>
    Promise.all(Array.from({ length: times }, async () => (await app().inject(options)).statusCode))

  type RequestOfProps = { route: Route; remoteAddress: string }

  const requestOf = ({ route, remoteAddress }: RequestOfProps): InjectOptions =>
    route.method === ROUTE_METHODS.get
      ? { method: route.method, url: pathOf({ route }), remoteAddress }
      : { method: route.method, url: pathOf({ route }), remoteAddress, payload: {} }

  it('answers a client from the internet 429 past the strict limit, with Retry-After and a JSON error', async () => {
    const options = { url: ECHO, remoteAddress: away(1) }
    const answered = await statuses({ options, times: STRICT })
    expect(answered.every((status) => status !== TOO_MANY_REQUESTS)).toBe(true)
    timing.advance(15_000)
    const refused = await app().inject(options)
    expect(refused.statusCode).toBe(TOO_MANY_REQUESTS)
    expect(refused.headers[HEADERS.retryAfter]).toBe('45')
    expect(refused.headers[HEADERS.cacheControl]).toBe(CACHE_POLICIES.noStore)
    expect(refused.json()).toEqual({
      statusCode: TOO_MANY_REQUESTS,
      message: 'Too many requests. Try again in 45 seconds.',
    })
  })

  it('limits every strict route at the strict limit', async () => {
    const refusals = await Promise.all(
      RATE_ROUTES[RATE_TIERS.strict].map(async (route, n) => {
        const options = requestOf({ route, remoteAddress: away(10 + n) })
        await statuses({ options, times: STRICT })
        const refused = await app().inject(options)
        return {
          path: route.path,
          status: refused.statusCode,
          wait: refused.headers[HEADERS.retryAfter],
        }
      }),
    )
    expect(refusals).toEqual(
      RATE_ROUTES[RATE_TIERS.strict].map(({ path }) => ({
        path,
        status: TOO_MANY_REQUESTS,
        wait: String(WINDOW_MS / 1000),
      })),
    )
  })

  it('lets an ordinary route take the standard limit, and counts a path no route declares with it', async () => {
    const remoteAddress = away(20)
    const lockState = { url: pathOf({ route: ROUTES.lockState }), remoteAddress }
    const answered = await allStatuses({ options: lockState, times: STANDARD })
    expect(answered.filter((status) => status !== 200)).toEqual([])
    expect((await app().inject(lockState)).statusCode).toBe(TOO_MANY_REQUESTS)
    expect((await app().inject({ url: '/api/nothing-here', remoteAddress })).statusCode).toBe(
      TOO_MANY_REQUESTS,
    )
    expect((await app().inject({ url: ECHO, remoteAddress })).statusCode).not.toBe(
      TOO_MANY_REQUESTS,
    )
  })

  it('never limits a long run of HLS segments and file ranges, nor lets them spend the standard budget', async () => {
    const remoteAddress = away(30)
    const runs = MEDIA / 2 - 50
    const segment = {
      url: pathOf({ route: ROUTES.hlsSegment, params: { [HLS_PARAMS.session]: 'session' } }),
      remoteAddress,
    }
    const range = {
      url: pathOf({ route: ROUTES.file }),
      remoteAddress,
      headers: { [HEADERS.range]: 'bytes=1048576-' },
    }
    const answered = [
      ...(await allStatuses({ options: segment, times: runs })),
      ...(await allStatuses({ options: range, times: runs })),
    ]
    expect(answered.length).toBeGreaterThan(STANDARD * 2)
    expect(answered.filter((status) => status === TOO_MANY_REQUESTS)).toEqual([])
    expect(
      (await app().inject({ url: pathOf({ route: ROUTES.lockState }), remoteAddress })).statusCode,
    ).toBe(200)
  })

  it('never limits the home network, on its own socket or behind the proxy', async () => {
    const direct = await statuses({
      options: { url: ECHO, remoteAddress: HOME },
      times: STRICT * 3,
    })
    const proxied = await statuses({
      options: {
        url: ECHO,
        remoteAddress: PROXY,
        headers: { [RAVEN_HEADERS.forwardedFor]: HOME },
      },
      times: STRICT * 3,
    })
    expect([...direct, ...proxied].filter((status) => status === TOO_MANY_REQUESTS)).toEqual([])
  })

  it('counts a client behind the proxy by the address the proxy appended', async () => {
    const through = (client: string): InjectOptions => ({
      url: ECHO,
      remoteAddress: PROXY,
      headers: { [RAVEN_HEADERS.forwardedFor]: `${HOME}, ${client}` },
    })
    await statuses({ options: through(away(40)), times: STRICT })
    expect((await app().inject(through(away(40)))).statusCode).toBe(TOO_MANY_REQUESTS)
    expect((await app().inject(through(away(41)))).statusCode).not.toBe(TOO_MANY_REQUESTS)
  })

  it('pays no heed to an X-Forwarded-For a client on a public socket writes itself', async () => {
    const forged = await Promise.all(
      Array.from({ length: STRICT + 1 }, (_, n) => n).map(async (n) => {
        const response = await app().inject({
          url: ECHO,
          remoteAddress: away(50),
          headers: { [RAVEN_HEADERS.forwardedFor]: n % 2 === 0 ? HOME : away(100 + n) },
        })
        return response.statusCode
      }),
    )
    expect(forged.filter((status) => status === TOO_MANY_REQUESTS)).toEqual([TOO_MANY_REQUESTS])
  })

  it('lets a limited client in again once its window ends', async () => {
    const options = { url: ECHO, remoteAddress: away(60) }
    await statuses({ options, times: STRICT })
    expect((await app().inject(options)).statusCode).toBe(TOO_MANY_REQUESTS)
    timing.advance(WINDOW_MS - 1)
    expect((await app().inject(options)).statusCode).toBe(TOO_MANY_REQUESTS)
    timing.advance(1)
    const reopened = await statuses({ options, times: STRICT + 1 })
    expect(reopened.filter((status) => status === TOO_MANY_REQUESTS)).toEqual([TOO_MANY_REQUESTS])
    expect(reopened.at(-1)).toBe(TOO_MANY_REQUESTS)
  })
})
