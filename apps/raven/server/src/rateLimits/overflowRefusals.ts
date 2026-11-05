import type { FastifyRequest } from 'fastify'

/**
 * The requests the `strict` tier's shared overflow window turned away, and
 * the seconds until it opens again, left for `AccountRateGuard` to answer
 * once the account gate knows who asks. Keyed by the raw request, which the
 * limiter's hook and the guard both see, and gone with it.
 */
const refused = new WeakMap<FastifyRequest['raw'], number>()

type MarkOverflowProps = { request: Pick<FastifyRequest, 'raw'>; retryAfterS: number }

export const markOverflow = ({ request, retryAfterS }: MarkOverflowProps): void => {
  refused.set(request.raw, retryAfterS)
}

type OverflowOfProps = { request: Pick<FastifyRequest, 'raw'> }

/** The seconds a refused request waits, or null for one the overflow window let through. */
export const overflowOf = ({ request }: OverflowOfProps): number | null =>
  refused.get(request.raw) ?? null
