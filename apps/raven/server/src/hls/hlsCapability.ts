import { randomBytes } from 'node:crypto'
import { isString } from '@raven/core'
import { AUTH_ENCODINGS } from '@/auth/accessToken'

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

/**
 * A new capability: random, and never derived from the ticket that opened
 * the session. It is the secret of the session's account pass.
 */
export const mintCapability = (): string =>
  `${HLS_CAPABILITY_PREFIX}${randomBytes(CAPABILITY_BYTES).toString(AUTH_ENCODINGS.base64url)}`

export const isHlsCapability = (value: unknown): value is string =>
  isString(value) &&
  value.startsWith(HLS_CAPABILITY_PREFIX) &&
  CAPABILITY_BODY.test(value.slice(HLS_CAPABILITY_PREFIX.length))
