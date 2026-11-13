import { SignJWT } from 'jose'
import { describe, expect, it } from 'vitest'
import { rateKeyOf } from '@/rateLimits/limitRavenRequests'
import { NETLIFY_HEADERS } from '@/rateLimits/netlifyClient'
import { RATE_TIERS } from '@/rateLimits/rateTiers'
import { HEADERS } from '@shared/server'

const SECRET = new TextEncoder().encode('a-proxy-secret-of-at-least-32-characters')
const OTHER = new TextEncoder().encode('another-secret-of-at-least-32-characters')

/** The address Netlify's proxy calls from, which Fastify resolves `ip` to past the trusted reverse proxy. */
const NETLIFY = '3.120.0.9'

type SignedProps = { secret?: Uint8Array; expiresIn?: string; issuer?: string }

/** A signature as Netlify's signed proxy makes one. */
const signed = ({ secret = SECRET, expiresIn = '5m', issuer = 'netlify' }: SignedProps = {}) =>
  new SignJWT({ site_url: 'https://raven-player.netlify.app' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(issuer)
    .setExpirationTime(expiresIn)
    .sign(secret)

type KeyOfProps = {
  ip: string
  headers?: Record<string, string>
  proxySecret?: Uint8Array | null
}

const keyOf = ({ ip, headers = {}, proxySecret = SECRET }: KeyOfProps): Promise<string> =>
  rateKeyOf({ request: { ip, headers }, tier: RATE_TIERS.standard, proxySecret })

describe('rateKeyOf', () => {
  it('counts a client by the address Fastify resolved, never by a header it wrote', async () => {
    await expect(
      keyOf({
        ip: '2001:db8:9:9::7',
        headers: { [HEADERS.forwardedFor]: '10.0.0.5, 198.51.100.1' },
      }),
    ).resolves.toBe('2001:db8:9:9::/64')
  })

  it("counts a visitor of the Netlify site by their own address once Netlify's signature holds", async () => {
    const sign = await signed()
    await expect(
      keyOf({
        ip: NETLIFY,
        headers: {
          [NETLIFY_HEADERS.sign]: sign,
          [NETLIFY_HEADERS.clientAddress]: '203.0.113.7',
          [HEADERS.forwardedFor]: `203.0.113.7, ${NETLIFY}`,
        },
      }),
    ).resolves.toBe('203.0.113.7')
  })

  it('takes no place in X-Forwarded-For on trust when Netlify names no address', async () => {
    const sign = await signed()
    await expect(
      keyOf({
        ip: NETLIFY,
        headers: {
          [NETLIFY_HEADERS.sign]: sign,
          [HEADERS.forwardedFor]: `198.51.100.1, 203.0.113.8, ${NETLIFY}`,
        },
      }),
    ).resolves.toBe(NETLIFY)
  })

  it("believes no visitor address without Netlify's valid, unexpired signature", async () => {
    const forged = {
      [NETLIFY_HEADERS.clientAddress]: '203.0.113.7',
      [HEADERS.forwardedFor]: `203.0.113.7, ${NETLIFY}`,
    }
    const cases = await Promise.all([
      keyOf({ ip: NETLIFY, headers: forged }),
      keyOf({ ip: NETLIFY, headers: { ...forged, [NETLIFY_HEADERS.sign]: 'not.a.jws' } }),
      signed({ secret: OTHER }).then((sign) =>
        keyOf({ ip: NETLIFY, headers: { ...forged, [NETLIFY_HEADERS.sign]: sign } }),
      ),
      signed({ expiresIn: '-1m' }).then((sign) =>
        keyOf({ ip: NETLIFY, headers: { ...forged, [NETLIFY_HEADERS.sign]: sign } }),
      ),
      signed({ issuer: 'someone' }).then((sign) =>
        keyOf({ ip: NETLIFY, headers: { ...forged, [NETLIFY_HEADERS.sign]: sign } }),
      ),
      signed().then((sign) =>
        keyOf({
          ip: NETLIFY,
          headers: { ...forged, [NETLIFY_HEADERS.sign]: sign },
          proxySecret: null,
        }),
      ),
    ])
    expect(cases).toEqual(Array.from({ length: cases.length }, () => NETLIFY))
  })
})
