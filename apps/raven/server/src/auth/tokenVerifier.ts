import { HttpException } from '@nestjs/common'
import { AUTH_CONFIG_STATES, AUTH_REFUSALS, type AuthConfig, isAccountId } from '@raven/core'
import { createRemoteJWKSet, customFetch, errors, jwtVerify, type JWTVerifyGetKey } from 'jose'
import { authFailure } from '@/auth/authFailure'

export const AUTH_FETCH = Symbol('AUTH_FETCH')
type AuthFetchProps = { url: string; init: RequestInit }

export type AuthFetch = (request: AuthFetchProps) => Promise<Response>

const ALGORITHMS = ['ES256', 'RS256'] as const
export const AUTH_JWT_ROLE = 'authenticated'
const REQUIRED_CLAIMS = ['sub', 'exp', 'iat', 'role'] as const
export const AUTH_REDIRECT_POLICY = 'error'
const AUTH_JWT_PATHS = { issuer: '/auth/v1', keys: '/auth/v1/.well-known/jwks.json' } as const
const INVALID_TOKEN_ERRORS = [
  errors.JWTExpired,
  errors.JWTClaimValidationFailed,
  errors.JWSSignatureVerificationFailed,
  errors.JWSInvalid,
  errors.JWTInvalid,
  errors.JOSEAlgNotAllowed,
  errors.JOSENotSupported,
  errors.JWKSNoMatchingKey,
] as const

type CreateTokenVerifierProps = {
  config: AuthConfig
  keys?: JWTVerifyGetKey
  authFetch: AuthFetch
}

export const createTokenVerifier = ({ config, keys, authFetch }: CreateTokenVerifierProps) => {
  const keySet =
    config.state === AUTH_CONFIG_STATES.ready
      ? (keys ??
        createRemoteJWKSet(new URL(`${config.supabaseUrl}${AUTH_JWT_PATHS.keys}`), {
          timeoutDuration: 5_000,
          cooldownDuration: 30_000,
          [customFetch]: (url, init) =>
            authFetch({ url, init: { ...init, redirect: AUTH_REDIRECT_POLICY } }),
        }))
      : null

  type CreateTokenVerifierCallbackProps = { token: string }

  return async ({ token }: CreateTokenVerifierCallbackProps) => {
    if (config.state !== AUTH_CONFIG_STATES.ready || keySet === null) {
      throw authFailure(AUTH_REFUSALS.unavailable)
    }
    try {
      const { payload } = await jwtVerify(token, keySet, {
        issuer: `${config.supabaseUrl}${AUTH_JWT_PATHS.issuer}`,
        audience: AUTH_JWT_ROLE,
        algorithms: [...ALGORITHMS],
        requiredClaims: [...REQUIRED_CLAIMS],
        clockTolerance: 30,
      })
      if (
        !isAccountId(payload.sub) ||
        payload.role !== AUTH_JWT_ROLE ||
        payload.is_anonymous === true ||
        !Number.isSafeInteger(payload.exp) ||
        payload.exp === undefined
      ) {
        throw authFailure(AUTH_REFUSALS.signedOut)
      }
      return { id: payload.sub, expiresAt: payload.exp * 1000 }
    } catch (error) {
      if (INVALID_TOKEN_ERRORS.some((failure) => error instanceof failure)) {
        throw authFailure(AUTH_REFUSALS.signedOut)
      }
      // Our deliberate refusal above must not be mistaken for a JWKS outage.
      if (error instanceof HttpException) throw error
      throw authFailure(AUTH_REFUSALS.unavailable)
    }
  }
}
