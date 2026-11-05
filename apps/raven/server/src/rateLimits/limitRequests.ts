import { CACHE_POLICIES, HEADERS } from '@shared/server'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

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

/**
 * What a request's count says: let it through, refused by the client's own
 * window, or refused by the shared window a full `overflow` tier counts
 * every new client in.
 */
export const RATE_VERDICTS = {
  allowed: 'allowed',
  limited: 'limited',
  overflowed: 'overflowed',
} as const

export type RateVerdict =
  | { verdict: typeof RATE_VERDICTS.allowed }
  | { verdict: typeof RATE_VERDICTS.limited; retryAfterS: number }
  | { verdict: typeof RATE_VERDICTS.overflowed; retryAfterS: number }

/** The status a limited request is answered with. */
export const TOO_MANY_REQUESTS = 429

/** What a refusal says, by whose budget ran out. */
export const TOO_MANY_MESSAGES = {
  address: 'Too many requests.',
  account: 'Too many requests for this account.',
  everyone: 'Too many requests from new addresses at once.',
} as const

type TooManyMessage = (typeof TOO_MANY_MESSAGES)[keyof typeof TOO_MANY_MESSAGES]

type RefusalProps = { reply: FastifyReply; retryAfterS: number; message: TooManyMessage }

/**
 * Marks a reply as refused for `retryAfterS` seconds, uncached, and says the
 * message it is answered with; the caller sends it or throws it.
 */
export const refusalOf = ({ reply, retryAfterS, message }: RefusalProps): string => {
  reply.header(HEADERS.retryAfter, String(retryAfterS))
  reply.header(HEADERS.cacheControl, CACHE_POLICIES.noStore)
  return `${message} Try again in ${retryAfterS} seconds.`
}

type Window = { endsAt: number; count: number }

type HitProps = { key: string; now: number }

type RetryProps = { endsAt: number; now: number }

type DropEndedProps = { now: number }

const ALLOWED: RateVerdict = { verdict: RATE_VERDICTS.allowed }

const retryAfterOf = ({ endsAt, now }: RetryProps): number =>
  Math.max(1, Math.ceil((endsAt - now) / 1000))

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
      if (current.count >= this.rate.limit) {
        return {
          verdict: RATE_VERDICTS.limited,
          retryAfterS: retryAfterOf({ endsAt: current.endsAt, now }),
        }
      }
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
      return {
        verdict: RATE_VERDICTS.overflowed,
        retryAfterS: retryAfterOf({ endsAt: this.overflow.endsAt, now }),
      }
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
  /** Which tier a request is counted in, or null for one this hook never counts. */
  tierOf: (request: FastifyRequest) => Tier | null
  /** Who a request is counted against in its tier: the client's address, as far as the server trusts it. */
  clientOf: (props: ClientOfProps<Tier>) => Promise<string>
  now: () => number
}

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
  now,
}: LimitRequestsProps<Tier>): void => {
  const counts = new Map(keysOf(limits).map((tier) => [tier, new RequestCounts(limits[tier])]))
  fastify.addHook('onRequest', async (request, reply) => {
    const tier = tierOf(request)
    if (tier === null) return undefined
    const counted =
      counts.get(tier)?.hit({ key: await clientOf({ request, tier }), now: now() }) ?? ALLOWED
    if (counted.verdict === RATE_VERDICTS.allowed) return undefined
    const message = refusalOf({
      reply,
      retryAfterS: counted.retryAfterS,
      message: TOO_MANY_MESSAGES.address,
    })
    // Returning the reply ends the request here instead of running the route.
    return reply.code(TOO_MANY_REQUESTS).send({ statusCode: TOO_MANY_REQUESTS, message })
  })
}
