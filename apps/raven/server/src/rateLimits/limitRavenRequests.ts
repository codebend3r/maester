import type { Type } from '@nestjs/common'
import { keyOfAddress } from '@raven/core'
import { HTTP_METHODS } from '@shared/server'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { limitRequests } from '@/rateLimits/limitRequests'
import { netlifyClientOf } from '@/rateLimits/netlifyClient'
import { RATE_LIMITS, RATE_PREFIX_BITS, RATE_TIERS, type RateTier } from '@/rateLimits/rateTiers'
import { type ClientRequest, clientAddressOf, isLanRequest } from '@/remoteAccess/clientNetwork'
import { type RouteMark, routeMarks } from '@/routeMarks'

type RouteKeyProps = Pick<RouteMark, 'method' | 'path'>

const routeKey = ({ method, path }: RouteKeyProps): string => `${method} ${path}`

/** Fastify answers a HEAD with its GET route, so a HEAD is counted as the GET is. */
const routeMethodOf = (method: string): string =>
  method === HTTP_METHODS.head ? HTTP_METHODS.get : method

type RateKeyOfProps = {
  request: ClientRequest
  tier: RateTier
  /** The secret Netlify's proxy signs with, so its visitors are counted by their own addresses. */
  proxySecret: Uint8Array | null
}

/** Who a request is counted against in its tier: its client, a Netlify visitor by their own address. */
export const rateKeyOf = async ({
  request,
  tier,
  proxySecret,
}: RateKeyOfProps): Promise<string> => {
  const address =
    (await netlifyClientOf({ request, secret: proxySecret })) ?? clientAddressOf({ request })
  return keyOfAddress({ address, prefixBits: RATE_PREFIX_BITS[tier] })
}

type LimitRavenRequestsProps = {
  fastify: FastifyInstance
  controllers: readonly Type[]
  now: () => number
  proxySecret: Uint8Array | null
}

/** The tiers this hook counts: `strict` is `AccountRateGuard`'s, which knows the account. */
const HOOK_LIMITS = {
  [RATE_TIERS.standard]: RATE_LIMITS[RATE_TIERS.standard],
  [RATE_TIERS.media]: RATE_LIMITS[RATE_TIERS.media],
} as const

/**
 * Counts each request from the internet against its client in its route's
 * `standard` or `media` tier (`rateTierOf`), before the route runs, and
 * answers 429 past the tier's limit. The home network is never counted
 * here, and a path no route declares is given no more than the `standard`
 * tier. The `strict` tier is counted by `AccountRateGuard` alone.
 */
export const limitRavenRequests = ({
  fastify,
  controllers,
  now,
  proxySecret,
}: LimitRavenRequestsProps): void => {
  const tiers = new Map(routeMarks(controllers).map((mark) => [routeKey(mark), mark.rate]))
  const tierOf = (request: FastifyRequest): RateTier =>
    tiers.get(
      routeKey({
        method: routeMethodOf(request.method),
        path: request.routeOptions.url ?? '',
      }),
    ) ?? RATE_TIERS.standard
  limitRequests({
    fastify,
    limits: HOOK_LIMITS,
    tierOf: (request) => {
      const tier = tierOf(request)
      if (tier === RATE_TIERS.strict || isLanRequest({ request })) return null
      return tier
    },
    clientOf: ({ request, tier }) => rateKeyOf({ request, tier, proxySecret }),
    now,
  })
}
