import { randomBytes } from 'node:crypto'
import { SetMetadata } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { isString } from '@raven/core'
import { sameSecret } from '@shared/server'
import { AUTH_ENCODINGS } from '@/auth/accessToken'
import type { MarkTargets } from '@/routeMarks'

/**
 * What starts an HLS session's capability, so the account gate tells it
 * from an account ticket (`account.`) and a legacy HMAC ticket in the same
 * `?t=`, where every client already keeps a media credential out of its logs.
 */
export const HLS_CAPABILITY_PREFIX = 'hls.'

/** 256 random bits, as an account ticket has. */
const CAPABILITY_BYTES = 32

/** 32 bytes in base64url without padding. */
const CAPABILITY_BODY = /^[A-Za-z0-9_-]{43}$/

/** A new capability: random, and never derived from the ticket that opened the session. */
export const mintCapability = (): string =>
  `${HLS_CAPABILITY_PREFIX}${randomBytes(CAPABILITY_BYTES).toString(AUTH_ENCODINGS.base64url)}`

export const isHlsCapability = (value: unknown): value is string =>
  isString(value) &&
  value.startsWith(HLS_CAPABILITY_PREFIX) &&
  CAPABILITY_BODY.test(value.slice(HLS_CAPABILITY_PREFIX.length))

/** Whether `given` is the session's capability, compared in constant time. */
export const isCapabilityOf = ({
  given,
  expected,
}: {
  given: unknown
  expected: string
}): boolean => isHlsCapability(given) && sameSecret({ given, expected })

const CAPABILITY_ROUTE = Symbol('CAPABILITY_ROUTE')

/**
 * Marks a route that names an HLS session, which that session's capability
 * opens once accounts are `ready`.
 */
export const OpenedByCapability = () => SetMetadata(CAPABILITY_ROUTE, true)

const decorators = new Reflector()

/** Whether a route is marked `OpenedByCapability`, read the same by the account gate and the route inventory. */
export const isCapabilityRoute = (targets: MarkTargets): boolean =>
  decorators.getAllAndOverride(CAPABILITY_ROUTE, targets) === true
