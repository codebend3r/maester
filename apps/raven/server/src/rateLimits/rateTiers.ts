import { SetMetadata } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { AddressPrefixBits } from '@raven/core'
import { isMediaPlaneRoute } from '@/media/mediaPlaneMark'
import { type RateLimit, WHEN_FULL } from '@/rateLimits/limitRequests'
import type { MarkTargets } from '@/routeMarks'

/** The budgets a route's requests are counted in, per client address. */
export const RATE_TIERS = { standard: 'standard', strict: 'strict', media: 'media' } as const

export type RateTier = (typeof RATE_TIERS)[keyof typeof RATE_TIERS]

const MINUTE_MS = 60_000

/** The most clients a tier counts at once; at about a hundred bytes each, a megabyte. */
const MAX_CLIENTS = 10_000

/**
 * Each tier's requests per client a minute. `limitRavenRequests` counts
 * `standard` and `media` from the internet only, the home network never;
 * `AccountRateGuard` counts `strict`, the home network too. Each tier counts
 * in a map of its own, and none drops a running window to make room.
 *
 * - `standard`, 1,200 (20 a second): a library grid scrolled hard asks a
 *   poster per card, a few hundred a minute, and the web app's first load
 *   some fifty files. Full of running windows, it lets a new client through
 *   uncounted: a page costs little, and refusing would take the site down
 *   for every new visitor during a flood.
 * - `strict`, 120 per address: the routes that check or hand out a secret.
 *   It bounds a flood from one address; each signed-in account has its own
 *   30 a minute on top (`ACCOUNT_STRICT_LIMIT`), so others behind a shared
 *   address are not locked out by one of them. Full of running windows, it
 *   counts every new address together, 600 a minute in all
 *   (`overflowLimit`): moving through addresses still meets that ceiling,
 *   and a flood that fills the map degrades the tier to it, never to zero.
 *   `AccountRateGuard` counts it after the account gate, so a refusal by
 *   that shared ceiling holds back only a caller with no account: a
 *   signed-in account goes by its own budget alone, so no flood of
 *   strangers can lock the owner out of the PIN or a ticket.
 * - `media`, 3,000 (50 a second): HLS asks a 6 s segment every 6 s, with a
 *   playlist and a subtitle segment beside it, under 40 a minute a viewer;
 *   a seek asks a few segments or one `file` range. Ten viewers behind one
 *   NAT, all seeking, stay well under it: it stops a flood, it never paces
 *   a viewer. Full, it lets a new viewer through, as `standard` does.
 */
export const RATE_LIMITS = {
  [RATE_TIERS.standard]: {
    limit: 1_200,
    windowMs: MINUTE_MS,
    maxKeys: MAX_CLIENTS,
    whenFull: WHEN_FULL.allow,
  },
  [RATE_TIERS.strict]: {
    limit: 120,
    windowMs: MINUTE_MS,
    maxKeys: MAX_CLIENTS,
    whenFull: WHEN_FULL.overflow,
    overflowLimit: 600,
  },
  [RATE_TIERS.media]: {
    limit: 3_000,
    windowMs: MINUTE_MS,
    maxKeys: MAX_CLIENTS,
    whenFull: WHEN_FULL.allow,
  },
} as const satisfies Record<RateTier, RateLimit>

/**
 * Each signed-in account's own budget on the `strict` routes: a PIN or a
 * password is typed a few times a minute, and a player mints a ticket per
 * title or track it opens, so skipping a track every two seconds stays under
 * it. Counted by the account the gate verified, so no one can spend another's.
 * Only approved accounts are counted, and there are far fewer than
 * `MAX_CLIENTS` of them, so a full map is no way in; were it ever full, a new
 * account would go uncounted rather than be refused for others' sake.
 */
export const ACCOUNT_STRICT_LIMIT = {
  limit: 30,
  windowMs: MINUTE_MS,
  maxKeys: MAX_CLIENTS,
  whenFull: WHEN_FULL.allow,
} as const satisfies RateLimit

/**
 * How much of an IPv6 address counts as one client in each tier: a phone or
 * a home's network is a /64, and a whole home or site is handed as much as a
 * /48, which the `strict` tier takes as one client so one allocation can not
 * mint thousands of keys to fill its map.
 */
export const RATE_PREFIX_BITS = {
  [RATE_TIERS.standard]: 64,
  [RATE_TIERS.strict]: 48,
  [RATE_TIERS.media]: 64,
} as const satisfies Record<RateTier, AddressPrefixBits>

const STRICTLY_LIMITED = Symbol('STRICTLY_LIMITED')

/** Marks a route that checks or hands out a secret, so it is counted in the `strict` tier. */
export const StrictlyLimited = () => SetMetadata(STRICTLY_LIMITED, true)

const decorators = new Reflector()

/**
 * A route's tier: `strict` when marked `StrictlyLimited`, `media` on the
 * media plane, and `standard` for every other route, so a new route is
 * limited the moment it exists.
 */
export const rateTierOf = (targets: MarkTargets): RateTier => {
  if (!!decorators.getAllAndOverride(STRICTLY_LIMITED, targets)) return RATE_TIERS.strict
  return isMediaPlaneRoute(targets) ? RATE_TIERS.media : RATE_TIERS.standard
}
