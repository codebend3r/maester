import {
  AUTH_CONFIG_STATES,
  AUTH_COOKIE,
  AUTH_HEADERS,
  AUTH_SCHEME,
  MEMBER_STATUSES,
  type Account,
  isRecord,
  isAccountId,
  isMemberStatus,
  isNumber,
} from '@raven/core'
import {
  createLocalJWKSet,
  decodeJwt,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JWTPayload,
} from 'jose'
import { vi } from 'vitest'
import { AUTH_JWT_ROLE, type AuthFetch } from '@/auth/tokenVerifier'

export const AUTH_TEST_IDS = {
  owner: '20000000-0000-4000-8000-000000000001',
  friend: '20000000-0000-4000-8000-000000000002',
  pending: '20000000-0000-4000-8000-000000000003',
  revoked: '20000000-0000-4000-8000-000000000004',
  missing: '20000000-0000-4000-8000-000000000005',
} as const
export const AUTH_TEST_ALGORITHM = 'ES256'
export const AUTH_TEST_KID = 'raven-auth-test'
export const AUTH_TEST_CONFIG = {
  state: AUTH_CONFIG_STATES.ready,
  supabaseUrl: 'https://auth.example.test',
  publishableKey: 'sb_publishable_test',
  webUrl: 'https://raven.example.test',
  cookieName: AUTH_COOKIE,
} as const
export const AUTH_TEST_FAILURES = {
  none: 'none',
  network: 'network',
  malformed: 'malformed',
  denied: 'denied',
  wrongAccount: 'wrong-account',
} as const
const RPC_PATHS = {
  keys: '/auth/v1/.well-known/jwks.json',
  current: '/rest/v1/rpc/current_membership',
  list: '/rest/v1/rpc/list_members',
  status: '/rest/v1/rpc/set_member_status',
} as const
const SQL_ERRORS = { forbidden: '42501', missing: 'P0002' } as const

export const authFixture = async () => {
  const pair = await generateKeyPair(AUTH_TEST_ALGORITHM)
  const jwks = {
    keys: [{ ...(await exportJWK(pair.publicKey)), kid: AUTH_TEST_KID, alg: AUTH_TEST_ALGORITHM }],
  }
  const accounts: Record<string, Account> = {
    [AUTH_TEST_IDS.owner]: {
      id: AUTH_TEST_IDS.owner,
      email: 'owner@maester.test',
      status: MEMBER_STATUSES.approved,
      isOwner: true,
    },
    [AUTH_TEST_IDS.friend]: {
      id: AUTH_TEST_IDS.friend,
      email: 'friend@maester.test',
      status: MEMBER_STATUSES.approved,
      isOwner: false,
    },
    [AUTH_TEST_IDS.pending]: {
      id: AUTH_TEST_IDS.pending,
      email: 'waiting@maester.test',
      status: MEMBER_STATUSES.pending,
      isOwner: false,
    },
    [AUTH_TEST_IDS.revoked]: {
      id: AUTH_TEST_IDS.revoked,
      email: 'removed@maester.test',
      status: MEMBER_STATUSES.revoked,
      isOwner: false,
    },
  }
  const state: { failure: (typeof AUTH_TEST_FAILURES)[keyof typeof AUTH_TEST_FAILURES] } = {
    failure: AUTH_TEST_FAILURES.none,
  }
  const row = ({ id, email, status, isOwner }: Account) => ({
    id,
    email,
    status,
    is_owner: isOwner,
  })
  const fetcher = vi.fn<AuthFetch>(async ({ url, init }) => {
    if (state.failure === AUTH_TEST_FAILURES.network) throw new Error('Network unavailable')
    if (state.failure === AUTH_TEST_FAILURES.denied) return Response.json({}, { status: 401 })
    if (state.failure === AUTH_TEST_FAILURES.malformed) return Response.json({ unexpected: 'body' })
    const path = new URL(url).pathname
    if (path === RPC_PATHS.keys) return Response.json(jwks)
    const authorization = new Headers(init.headers).get(AUTH_HEADERS.authorization) ?? ''
    const token = authorization.slice(`${AUTH_SCHEME} `.length)
    const payload = decodeJwt(token)
    const account = payload.sub === undefined ? undefined : accounts[payload.sub]
    if (path === RPC_PATHS.current) {
      if (state.failure === AUTH_TEST_FAILURES.wrongAccount) {
        const owner = accounts[AUTH_TEST_IDS.owner]
        if (owner === undefined) throw new Error('Missing owner fixture')
        return Response.json([row(owner)])
      }
      return Response.json(account === undefined ? [] : [row(account)])
    }
    if (account === undefined || !account.isOwner || account.status !== MEMBER_STATUSES.approved) {
      return Response.json({ code: SQL_ERRORS.forbidden }, { status: 403 })
    }
    const body: unknown = typeof init.body === 'string' ? JSON.parse(init.body) : null
    if (
      path === RPC_PATHS.list &&
      isRecord(body) &&
      isNumber(body.page_offset) &&
      isNumber(body.page_size)
    ) {
      return Response.json(
        Object.values(accounts)
          .slice(body.page_offset, body.page_offset + body.page_size)
          .map(row),
      )
    }
    if (
      path === RPC_PATHS.status &&
      isRecord(body) &&
      isAccountId(body.member_id) &&
      isMemberStatus(body.member_status)
    ) {
      const target = accounts[body.member_id]
      if (target === undefined) return Response.json({ code: SQL_ERRORS.missing }, { status: 404 })
      if (target.isOwner) return Response.json({ code: SQL_ERRORS.forbidden }, { status: 403 })
      const changed = { ...target, status: body.member_status }
      accounts[body.member_id] = changed
      return Response.json([row(changed)])
    }
    throw new Error(`Unexpected auth URL: ${url}`)
  })
  const mint = async ({
    id = AUTH_TEST_IDS.friend,
    claims = {},
    expiresIn = 3600,
    issuer = `${AUTH_TEST_CONFIG.supabaseUrl}/auth/v1`,
    audience = AUTH_JWT_ROLE,
  }: {
    id?: string
    claims?: JWTPayload
    expiresIn?: number
    issuer?: string
    audience?: string
  } = {}) =>
    new SignJWT({ role: AUTH_JWT_ROLE, ...claims })
      .setProtectedHeader({ alg: AUTH_TEST_ALGORITHM, kid: AUTH_TEST_KID })
      .setSubject(id)
      .setIssuedAt()
      .setIssuer(issuer)
      .setAudience(audience)
      .setExpirationTime(Math.floor(Date.now() / 1000) + expiresIn)
      .sign(pair.privateKey)

  return { accounts, state, fetcher, mint, pair, keys: createLocalJWKSet(jwks) }
}
