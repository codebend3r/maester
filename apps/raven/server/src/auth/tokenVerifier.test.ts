import { AUTH_CONFIG_STATES, AUTH_REFUSALS } from '@raven/core'
import { SignJWT } from 'jose'
import { beforeAll, describe, expect, it } from 'vitest'
import { AUTH_JWT_ROLE, createTokenVerifier } from '@/auth/tokenVerifier'
import {
  AUTH_TEST_ALGORITHM,
  AUTH_TEST_CONFIG,
  AUTH_TEST_FAILURES,
  AUTH_TEST_IDS,
  AUTH_TEST_KID,
  authFixture,
} from '@/test/auth'

let fixture: Awaited<ReturnType<typeof authFixture>>
beforeAll(async () => {
  fixture = await authFixture()
})
const refused = (reason: string) => ({ response: { reason } })

describe('raven JWT verification', () => {
  it('verifies ES256 with the configured issuer, audience and required claims', async () => {
    const verify = createTokenVerifier({
      config: AUTH_TEST_CONFIG,
      keys: fixture.keys,
      authFetch: fixture.fetcher,
    })
    const token = await fixture.mint()
    await expect(verify({ token })).resolves.toMatchObject({ id: AUTH_TEST_IDS.friend })
    expect(fixture.fetcher).not.toHaveBeenCalled()
  })

  it('loads public keys from the configured JWKS URL without a privileged key', async () => {
    const verify = createTokenVerifier({ config: AUTH_TEST_CONFIG, authFetch: fixture.fetcher })
    await expect(verify({ token: await fixture.mint() })).resolves.toMatchObject({
      id: AUTH_TEST_IDS.friend,
    })
    expect(fixture.fetcher).toHaveBeenCalledWith(
      expect.objectContaining({
        url: `${AUTH_TEST_CONFIG.supabaseUrl}/auth/v1/.well-known/jwks.json`,
      }),
    )
  })

  it.each([
    { expiresIn: -60 },
    { issuer: 'https://other.example.test/auth/v1' },
    { audience: 'another-app' },
    { id: 'not-a-uuid' },
    { claims: { role: 'service_role' } },
    { claims: { role: null } },
    { claims: { is_anonymous: true } },
    { claims: { nbf: Math.floor(Date.now() / 1000) + 300 } },
  ])('rejects an invalid identity: %o', async (options) => {
    const verify = createTokenVerifier({
      config: AUTH_TEST_CONFIG,
      keys: fixture.keys,
      authFetch: fixture.fetcher,
    })
    await expect(verify({ token: await fixture.mint(options) })).rejects.toMatchObject(
      refused(AUTH_REFUSALS.signedOut),
    )
  })

  it('rejects missing expiry, missing subject and missing role', async () => {
    const verify = createTokenVerifier({
      config: AUTH_TEST_CONFIG,
      keys: fixture.keys,
      authFetch: fixture.fetcher,
    })
    const incomplete = () =>
      new SignJWT({ role: AUTH_JWT_ROLE })
        .setProtectedHeader({ alg: AUTH_TEST_ALGORITHM, kid: AUTH_TEST_KID })
        .setIssuedAt()
        .setIssuer(`${AUTH_TEST_CONFIG.supabaseUrl}/auth/v1`)
        .setAudience(AUTH_JWT_ROLE)
    const tokens = await Promise.all([
      incomplete().setSubject(AUTH_TEST_IDS.friend).sign(fixture.pair.privateKey),
      incomplete()
        .setExpirationTime(Math.floor(Date.now() / 1000) + 3600)
        .sign(fixture.pair.privateKey),
      fixture.mint({ claims: { role: undefined } }),
    ])
    await Promise.all(
      tokens.map(async (token) => {
        await expect(verify({ token })).rejects.toMatchObject(refused(AUTH_REFUSALS.signedOut))
      }),
    )
  })

  it('rejects malformed, tampered, unknown-key and symmetric tokens', async () => {
    const verify = createTokenVerifier({
      config: AUTH_TEST_CONFIG,
      keys: fixture.keys,
      authFetch: fixture.fetcher,
    })
    const token = await fixture.mint()
    const unknownKey = await new SignJWT({})
      .setProtectedHeader({ alg: AUTH_TEST_ALGORITHM, kid: 'unknown-key' })
      .sign(fixture.pair.privateKey)
    const symmetric = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .sign(new TextEncoder().encode('a-test-secret-long-enough-for-the-HMAC'))
    await Promise.all(
      ['broken', `${token.slice(0, -4)}xxxx`, unknownKey, symmetric].map(async (bad) => {
        await expect(verify({ token: bad })).rejects.toMatchObject(refused(AUTH_REFUSALS.signedOut))
      }),
    )
  })

  it('distinguishes an unavailable JWKS service from bad credentials', async () => {
    const isolated = await authFixture()
    isolated.state.failure = AUTH_TEST_FAILURES.network
    const verify = createTokenVerifier({ config: AUTH_TEST_CONFIG, authFetch: isolated.fetcher })
    await expect(verify({ token: await isolated.mint() })).rejects.toMatchObject(
      refused(AUTH_REFUSALS.unavailable),
    )
  })

  it('fails closed when auth is not configured', async () => {
    const verify = createTokenVerifier({
      config: { state: AUTH_CONFIG_STATES.off },
      authFetch: fixture.fetcher,
    })
    await expect(verify({ token: await fixture.mint() })).rejects.toMatchObject(
      refused(AUTH_REFUSALS.unavailable),
    )
  })
})
