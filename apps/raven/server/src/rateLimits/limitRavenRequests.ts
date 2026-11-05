import type { Type } from '@nestjs/common'
import { HTTP_METHODS, limitRequests } from '@shared/server'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { netlifyClientOf } from '@/rateLimits/netlifyClient'
import { markOverflow } from '@/rateLimits/overflowRefusals'
import { RATE_LIMITS, RATE_PREFIX_BITS, RATE_TIERS, type RateTier } from '@/rateLimits/rateTiers'
import { clientAddressOf, isLanRequest } from '@/remoteAccess/clientNetwork'
import { type RouteMark, routeMarks } from '@/routeMarks'

type RouteKeyProps = Pick<RouteMark, 'method' | 'path'>

const routeKey = ({ method, path }: RouteKeyProps): string => `${method} ${path}`

/** Fastify answers a HEAD with its GET route, so a HEAD is counted as the GET is. */
const routeMethodOf = (method: string): string =>
  method === HTTP_METHODS.head ? HTTP_METHODS.get : method

const IPV6_GROUPS = 8
const HEX_PER_GROUP = 4
const BITS_PER_HEX = 4

const groupsIn = (text: string): string[] => (text === '' ? [] : text.split(':'))

/** An IPv6 address's eight groups, with `::` filled in, or null for anything else. */
const ipv6Groups = (address: string): string[] | null => {
  const halves = address.split('::')
  if (halves.length > 2) return null
  const [head = '', tail] = halves
  const front = groupsIn(head)
  if (tail === undefined) return front.length === IPV6_GROUPS ? front : null
  const back = groupsIn(tail)
  const missing = IPV6_GROUPS - front.length - back.length
  if (missing < 1) return null
  return [...front, ...Array.from({ length: missing }, () => '0'), ...back]
}

type KeyOfAddressProps = { address: string; prefixBits: number }

/**
 * Who an address is counted as: an IPv4 address (mapped into IPv6 or not) is
 * one client, and an IPv6 one counts by the prefix of `prefixBits` it lies in,
 * since a home or a phone is handed a whole /64 (or /56) to move through.
 */
export const keyOfAddress = ({ address, prefixBits }: KeyOfAddressProps): string => {
  const plain = address.trim().toLowerCase().replace(/%.*$/, '')
  if (!plain.includes(':') || plain.includes('.')) return plain
  const groups = ipv6Groups(plain)
  if (groups === null) return plain
  const hex = groups
    .map((group) => group.padStart(HEX_PER_GROUP, '0'))
    .join('')
    .slice(0, prefixBits / BITS_PER_HEX)
    .padEnd(HEX_PER_GROUP * HEX_PER_GROUP, '0')
  const prefix = Array.from({ length: HEX_PER_GROUP }, (_, n) =>
    Number.parseInt(hex.slice(n * HEX_PER_GROUP, (n + 1) * HEX_PER_GROUP), 16).toString(16),
  ).join(':')
  return `${prefix}::/${prefixBits}`
}

type RateKeyOfProps = Parameters<typeof clientAddressOf>[0] & {
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

/**
 * Counts each request from the internet against its client in its route's
 * tier (`rateTierOf`), and answers 429 past the tier's limit. A request from
 * the home network is never counted, nor is a path no route declares given
 * more than the `standard` tier.
 */
export const limitRavenRequests = ({
  fastify,
  controllers,
  now,
  proxySecret,
}: LimitRavenRequestsProps): void => {
  const tiers = new Map(routeMarks(controllers).map((mark) => [routeKey(mark), mark.rate]))
  limitRequests({
    fastify,
    limits: RATE_LIMITS,
    tierOf: (request: FastifyRequest): RateTier =>
      tiers.get(
        routeKey({
          method: routeMethodOf(request.method),
          path: request.routeOptions.url ?? '',
        }),
      ) ?? RATE_TIERS.standard,
    clientOf: ({ request, tier }) => rateKeyOf({ request, tier, proxySecret }),
    isExempt: (request) => isLanRequest({ request }),
    // A full `strict` tier's shared refusal waits for `AccountRateGuard`, which knows the account.
    deferOverflow: markOverflow,
    now,
  })
}
