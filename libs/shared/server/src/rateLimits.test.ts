import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { CACHE_POLICIES, HEADERS } from '@/http'
import {
  RATE_VERDICTS,
  RequestCounts,
  TOO_MANY_REQUESTS,
  WHEN_FULL,
  limitRequests,
} from '@/rateLimits'

const TIERS = { tight: 'tight', loose: 'loose' } as const

type Tier = (typeof TIERS)[keyof typeof TIERS]

const LIMITS = {
  [TIERS.tight]: {
    limit: 2,
    windowMs: 10_000,
    maxKeys: 100,
    whenFull: WHEN_FULL.overflow,
    overflowLimit: 100,
  },
  [TIERS.loose]: { limit: 5, windowMs: 10_000, maxKeys: 100, whenFull: WHEN_FULL.allow },
} as const

const PATHS = { tight: '/tight', loose: '/loose' } as const

const HOME = '192.168.1.5'

const tierOf = (request: FastifyRequest): Tier =>
  request.url === PATHS.tight ? TIERS.tight : TIERS.loose

type Booted = { fastify: FastifyInstance; advance: (ms: number) => void }

const boot = (): Booted => {
  const clock = { now: 0 }
  const fastify = Fastify()
  limitRequests({
    fastify,
    limits: LIMITS,
    tierOf,
    clientOf: async ({ request }) => request.ip,
    isExempt: (request) => request.ip === HOME,
    now: () => clock.now,
  })
  fastify.get(PATHS.tight, async () => ({ ok: true }))
  fastify.get(PATHS.loose, async () => ({ ok: true }))
  return {
    fastify,
    advance: (ms) => {
      clock.now += ms
    },
  }
}

type StatusesProps = { fastify: FastifyInstance; url: string; from: string; times: number }

/** Each request's status, sent one after another so they are counted in order. */
const statuses = async ({ fastify, url, from, times }: StatusesProps): Promise<number[]> =>
  Array.from({ length: times }).reduce<Promise<number[]>>(async (sent) => {
    const before = await sent
    const response = await fastify.inject({ url, remoteAddress: from })
    return [...before, response.statusCode]
  }, Promise.resolve([]))

describe('limitRequests', () => {
  const state: { booted: Booted | null } = { booted: null }
  const booted = (): Booted => {
    state.booted = state.booted ?? boot()
    return state.booted
  }

  afterEach(async () => {
    await state.booted?.fastify.close()
    state.booted = null
  })

  it('answers the request past the limit with 429, Retry-After in seconds and a JSON error', async () => {
    const { fastify, advance } = booted()
    await expect(
      statuses({ fastify, url: PATHS.tight, from: '198.51.100.1', times: 2 }),
    ).resolves.toEqual([200, 200])
    advance(2_500)
    const refused = await fastify.inject({ url: PATHS.tight, remoteAddress: '198.51.100.1' })
    expect(refused.statusCode).toBe(TOO_MANY_REQUESTS)
    expect(refused.headers[HEADERS.retryAfter]).toBe('8')
    expect(refused.headers[HEADERS.cacheControl]).toBe(CACHE_POLICIES.noStore)
    expect(refused.json()).toEqual({
      statusCode: TOO_MANY_REQUESTS,
      message: 'Too many requests. Try again in 8 seconds.',
    })
  })

  it('counts each client and each tier apart', async () => {
    const { fastify } = booted()
    await statuses({ fastify, url: PATHS.tight, from: '198.51.100.1', times: 3 })
    await expect(
      statuses({ fastify, url: PATHS.tight, from: '198.51.100.2', times: 2 }),
    ).resolves.toEqual([200, 200])
    await expect(
      statuses({ fastify, url: PATHS.loose, from: '198.51.100.1', times: 6 }),
    ).resolves.toEqual([200, 200, 200, 200, 200, TOO_MANY_REQUESTS])
  })

  it('never counts an exempt request', async () => {
    const { fastify } = booted()
    const answered = await statuses({ fastify, url: PATHS.tight, from: HOME, times: 50 })
    expect(answered.every((status) => status === 200)).toBe(true)
  })

  it('opens a new window once the last one ends', async () => {
    const { fastify, advance } = booted()
    await expect(
      statuses({ fastify, url: PATHS.tight, from: '198.51.100.1', times: 3 }),
    ).resolves.toEqual([200, 200, TOO_MANY_REQUESTS])
    advance(9_999)
    await expect(
      statuses({ fastify, url: PATHS.tight, from: '198.51.100.1', times: 1 }),
    ).resolves.toEqual([TOO_MANY_REQUESTS])
    advance(1)
    await expect(
      statuses({ fastify, url: PATHS.tight, from: '198.51.100.1', times: 3 }),
    ).resolves.toEqual([200, 200, TOO_MANY_REQUESTS])
  })
})

describe('RequestCounts', () => {
  const RATE = {
    limit: 1,
    windowMs: 1_000,
    maxKeys: 3,
    whenFull: WHEN_FULL.overflow,
    overflowLimit: 2,
  } as const

  it('never drops a running window to make room, so moving through addresses wipes no count', () => {
    const counts = new RequestCounts(RATE)
    ;['a', 'b', 'c'].forEach((key) => counts.hit({ key, now: 0 }))
    expect(counts.hit({ key: 'a', now: 0 }).verdict).toBe(RATE_VERDICTS.limited)
    ;['d', 'e', 'f'].forEach((key) => counts.hit({ key, now: 10 }))
    expect(counts.size).toBe(3)
    expect(counts.hit({ key: 'a', now: 500 }).verdict).toBe(RATE_VERDICTS.limited)
  })

  it('counts every client past a full map together, so rotating addresses meets one ceiling', () => {
    const counts = new RequestCounts(RATE)
    ;['a', 'b', 'c'].forEach((key, n) => counts.hit({ key, now: n * 100 }))
    expect(['d', 'e'].map((key) => counts.hit({ key, now: 400 }).verdict)).toEqual([
      RATE_VERDICTS.allowed,
      RATE_VERDICTS.allowed,
    ])
    expect(counts.hit({ key: 'f', now: 400 })).toEqual({
      verdict: RATE_VERDICTS.limited,
      retryAfterS: 1,
      isOverflow: true,
    })
    expect(counts.hit({ key: 'a', now: 400 })).toEqual({
      verdict: RATE_VERDICTS.limited,
      retryAfterS: 1,
      isOverflow: false,
    })
    expect(counts.hit({ key: 'g', now: 1_000 }).verdict).toBe(RATE_VERDICTS.allowed)
    expect(counts.size).toBe(3)
  })

  it('lets a new client through uncounted on a tier that may fail open', () => {
    const counts = new RequestCounts({
      limit: 1,
      windowMs: 1_000,
      maxKeys: 3,
      whenFull: WHEN_FULL.allow,
    })
    ;['a', 'b', 'c'].forEach((key) => counts.hit({ key, now: 0 }))
    expect(counts.hit({ key: 'd', now: 0 }).verdict).toBe(RATE_VERDICTS.allowed)
    expect(counts.hit({ key: 'd', now: 0 }).verdict).toBe(RATE_VERDICTS.allowed)
    expect(counts.size).toBe(3)
    expect(counts.hit({ key: 'a', now: 0 }).verdict).toBe(RATE_VERDICTS.limited)
  })

  it('drops ended windows from the front when it needs the room', () => {
    const counts = new RequestCounts({ ...RATE, overflowLimit: 0 })
    ;['a', 'b', 'c'].forEach((key) => counts.hit({ key, now: 0 }))
    expect(['d', 'e', 'f'].map((key) => counts.hit({ key, now: 1_000 }).verdict)).toEqual([
      RATE_VERDICTS.allowed,
      RATE_VERDICTS.allowed,
      RATE_VERDICTS.allowed,
    ])
    expect(counts.size).toBe(3)
    expect(counts.hit({ key: 'g', now: 1_000 }).verdict).toBe(RATE_VERDICTS.limited)
  })
})

describe('limitRequests per tier', () => {
  const small = { limit: 5, windowMs: 10_000, maxKeys: 2 } as const
  const LIMITED = {
    [TIERS.tight]: { ...small, whenFull: WHEN_FULL.overflow, overflowLimit: 1 },
    [TIERS.loose]: { ...small, whenFull: WHEN_FULL.allow },
  } as const

  type BootSmallProps = { deferred?: number[] }

  const bootSmall = ({ deferred }: BootSmallProps = {}) => {
    const fastify = Fastify()
    limitRequests({
      fastify,
      limits: LIMITED,
      tierOf,
      clientOf: async ({ request, tier }) => `${tier} ${request.ip}`,
      isExempt: () => false,
      deferOverflow:
        deferred === undefined ? undefined : ({ retryAfterS }) => deferred.push(retryAfterS),
      now: () => 0,
    })
    fastify.get(PATHS.tight, async () => ({ ok: true }))
    fastify.get(PATHS.loose, async () => ({ ok: true }))
    return fastify
  }

  type SentProps = { fastify: FastifyInstance; url: string; from: string }

  const sent = ({ fastify, url, from }: SentProps) =>
    fastify.inject({ url, remoteAddress: from }).then((response) => response.statusCode)

  it('keeps each tier in a map of its own, so one filling never refuses another', async () => {
    const fastify = bootSmall()
    const tight = ['198.51.100.1', '198.51.100.2', '198.51.100.3', '198.51.100.4']
    const tights = await tight.reduce<Promise<number[]>>(
      async (all, from) => [...(await all), await sent({ fastify, url: PATHS.tight, from })],
      Promise.resolve([]),
    )
    expect(tights).toEqual([200, 200, 200, TOO_MANY_REQUESTS])
    const loose = ['198.51.100.3', '198.51.100.4', '198.51.100.5']
    const looses = await loose.reduce<Promise<number[]>>(
      async (all, from) => [...(await all), await sent({ fastify, url: PATHS.loose, from })],
      Promise.resolve([]),
    )
    expect(looses).toEqual([200, 200, 200])
    await fastify.close()
  })

  it("hands an overflow refusal on to the server instead of answering it, a client's own refusal never", async () => {
    const deferred: number[] = []
    const fastify = bootSmall({ deferred })
    const senders = ['198.51.100.1', '198.51.100.2', '198.51.100.3', '198.51.100.4']
    const answered = await senders.reduce<Promise<number[]>>(
      async (all, from) => [...(await all), await sent({ fastify, url: PATHS.tight, from })],
      Promise.resolve([]),
    )
    expect(answered).toEqual([200, 200, 200, 200])
    expect(deferred).toEqual([10])
    await fastify.close()
  })
})
