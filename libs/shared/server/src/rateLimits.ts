import type { FastifyInstance, FastifyRequest } from 'fastify'
import { CACHE_POLICIES, HEADERS } from '@/http'

/**
 * What a tier does with a new client once its map holds `maxKeys` windows
 * that are all still running. `allow` lets the request through uncounted,
 * which suits a tier where a stranger's request costs only a page, so a
 * flood never takes the site down for everyone else. `overflow` counts every
 * such client together in one shared window of `overflowLimit`, which a tier
 * guarding a secret needs: moving through addresses still meets a ceiling,
 * and a flood that fills the map degrades the tier to that ceiling, never to
 * refusing every newcomer outright.
 */
export const WHEN_FULL = { allow: 'allow', overflow: 'overflow' } as const

/** How many requests one client may make in each window of `windowMs`, and how many clients are counted at once. */
export type RateLimit = {
  limit: number
  windowMs: number
  /** The most clients this tier counts at once; at about a hundred bytes each, 10,000 is a megabyte. */
  maxKeys: number
} & (
  | { whenFull: typeof WHEN_FULL.allow }
  | {
      whenFull: typeof WHEN_FULL.overflow
      /** The requests every client past `maxKeys` may make together in a window. */
      overflowLimit: number
    }
)

/** What a request's count says: let it through, or refuse it until the window ends. */
export const RATE_VERDICTS = { allowed: 'allowed', limited: 'limited' } as const

export type RateVerdict =
  | { verdict: typeof RATE_VERDICTS.allowed }
  | {
      verdict: typeof RATE_VERDICTS.limited
      retryAfterS: number
      /** Whether the shared overflow window refused it, not the client's own. */
      isOverflow: boolean
    }

/** The status a limited request is answered with. */
export const TOO_MANY_REQUESTS = 429

type Window = { endsAt: number; count: number }

type HitProps = { key: string; now: number }

type RetryProps = { endsAt: number; now: number; isOverflow?: boolean }

type DropEndedProps = { now: number }

const ALLOWED: RateVerdict = { verdict: RATE_VERDICTS.allowed }

const limitedUntil = ({ endsAt, now, isOverflow = false }: RetryProps): RateVerdict => ({
  verdict: RATE_VERDICTS.limited,
  retryAfterS: Math.max(1, Math.ceil((endsAt - now) / 1000)),
  isOverflow,
})

/**
 * One tier's counts per key, in fixed windows, in memory. A key's window
 * opens with its first request and ends `windowMs` later; the request past
 * the limit, and every one after it until then, is limited. Every window of
 * a tier lasts as long, and a window is put back at the end of the map when
 * it opens again, so the map's first window always ends first: making room
 * looks at that one alone. A running window is never dropped to make room,
 * so moving through addresses can not wipe a client's count; a client
 * that finds no room is counted in the tier's `whenFull` way.
 */
export class RequestCounts {
  private readonly windows = new Map<string, Window>()
  private overflow: Window = { endsAt: Number.NEGATIVE_INFINITY, count: 0 }

  constructor(private readonly rate: RateLimit) {}

  /** How many keys are counted now. */
  get size(): number {
    return this.windows.size
  }

  hit({ key, now }: HitProps): RateVerdict {
    const current = this.windows.get(key)
    if (current !== undefined && now < current.endsAt) {
      if (current.count >= this.rate.limit) return limitedUntil({ endsAt: current.endsAt, now })
      current.count += 1
      return ALLOWED
    }
    this.windows.delete(key)
    if (this.isFull({ now })) return this.overflowHit({ now })
    this.windows.set(key, { endsAt: now + this.rate.windowMs, count: 1 })
    return ALLOWED
  }

  /** Drops the windows at the front that have ended, while the map is full, and says whether it still is. */
  private isFull({ now }: DropEndedProps): boolean {
    const [first] = this.windows
    if (first === undefined || this.windows.size < this.rate.maxKeys) return false
    const [key, window] = first
    if (now < window.endsAt) return true
    this.windows.delete(key)
    return this.isFull({ now })
  }

  /** A client the full map has no room for: uncounted, or counted with every other in the shared window. */
  private overflowHit({ now }: DropEndedProps): RateVerdict {
    if (this.rate.whenFull === WHEN_FULL.allow) return ALLOWED
    if (now >= this.overflow.endsAt) this.overflow = { endsAt: now + this.rate.windowMs, count: 0 }
    if (this.overflow.count >= this.rate.overflowLimit) {
      return limitedUntil({ endsAt: this.overflow.endsAt, now, isOverflow: true })
    }
    this.overflow.count += 1
    return ALLOWED
  }
}

type ClientOfProps<Tier extends string> = { request: FastifyRequest; tier: Tier }

type LimitRequestsProps<Tier extends string> = {
  fastify: FastifyInstance
  /** Each tier's budget, counted apart in a map of its own, so one tier's requests never spend another's. */
  limits: Readonly<Record<Tier, RateLimit>>
  /** Which tier a request is counted in. */
  tierOf: (request: FastifyRequest) => Tier
  /** Who a request is counted against in its tier: the client's address, as far as the server trusts it. */
  clientOf: (props: ClientOfProps<Tier>) => Promise<string>
  /** Whether a request is never counted, as a request from the home network is. */
  isExempt: (request: FastifyRequest) => boolean
  /**
   * Hands on a refusal by the shared overflow window instead of answering it
   * here, for a server that answers it once it knows more of the caller: a
   * signed-in account, say, which has a budget of its own. Left out, the
   * refusal is answered as any other.
   */
  deferOverflow?: (props: DeferOverflowProps) => void
  now: () => number
}

type DeferOverflowProps = { request: FastifyRequest; retryAfterS: number }

const keysOf = <K extends string>(record: Readonly<Record<K, unknown>>): K[] =>
  Object.keys(record).filter((key): key is K => key in record)

/**
 * Limits how often each client may ask, per tier, before a route runs: past
 * its tier's limit a request is answered 429, with `Retry-After` in seconds
 * and a JSON body shaped as Nest's own errors are. It counts requests, never
 * bytes, so a long download is one request. Register it after any hook whose
 * headers a refusal should carry.
 */
export const limitRequests = <Tier extends string>({
  fastify,
  limits,
  tierOf,
  clientOf,
  isExempt,
  deferOverflow,
  now,
}: LimitRequestsProps<Tier>): void => {
  const counts = new Map(keysOf(limits).map((tier) => [tier, new RequestCounts(limits[tier])]))
  fastify.addHook('onRequest', async (request, reply) => {
    if (isExempt(request)) return undefined
    const tier = tierOf(request)
    const counted =
      counts.get(tier)?.hit({ key: await clientOf({ request, tier }), now: now() }) ?? ALLOWED
    if (counted.verdict === RATE_VERDICTS.allowed) return undefined
    if (counted.isOverflow && deferOverflow !== undefined) {
      deferOverflow({ request, retryAfterS: counted.retryAfterS })
      return undefined
    }
    // Returning the reply ends the request here instead of running the route.
    return reply
      .code(TOO_MANY_REQUESTS)
      .header(HEADERS.retryAfter, String(counted.retryAfterS))
      .header(HEADERS.cacheControl, CACHE_POLICIES.noStore)
      .send({
        statusCode: TOO_MANY_REQUESTS,
        message: `Too many requests. Try again in ${counted.retryAfterS} seconds.`,
      })
  })
}
