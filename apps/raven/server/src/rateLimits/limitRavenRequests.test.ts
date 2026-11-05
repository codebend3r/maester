import { SignJWT } from 'jose'
import { describe, expect, it } from 'vitest'
import { RAVEN_HEADERS } from '@/http'
import { keyOfAddress, rateKeyOf } from '@/rateLimits/limitRavenRequests'
import { NETLIFY_HEADERS } from '@/rateLimits/netlifyClient'
import { RATE_TIERS } from '@/rateLimits/rateTiers'

const SECRET = new TextEncoder().encode('a-proxy-secret-of-at-least-32-characters')
const OTHER = new TextEncoder().encode('another-secret-of-at-least-32-characters')

/** The NAS's reverse proxy, on Docker's bridge, and the address Netlify's proxy calls from. */
const PROXY = '172.17.0.1'
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

describe('keyOfAddress', () => {
  it('counts an IPv4 client by its address, mapped into IPv6 or not', () => {
    expect(keyOfAddress({ address: '198.51.100.20', prefixBits: 64 })).toBe('198.51.100.20')
    expect(keyOfAddress({ address: '::ffff:198.51.100.20', prefixBits: 64 })).toBe(
      '::ffff:198.51.100.20',
    )
  })

  it('counts an IPv6 client by the /64 it lies in, however the address is written', () => {
    expect(keyOfAddress({ address: '2001:db8:1:2:3:4:5:6', prefixBits: 64 })).toBe(
      '2001:db8:1:2::/64',
    )
    expect(keyOfAddress({ address: '2001:0DB8:0001:0002:ffff::1', prefixBits: 64 })).toBe(
      '2001:db8:1:2::/64',
    )
    expect(keyOfAddress({ address: '2001:db8::1', prefixBits: 64 })).toBe('2001:db8:0:0::/64')
  })

  it('counts a /56 as one client where the strict tier asks', () => {
    const one = keyOfAddress({ address: '2001:db8:1:2a00::1', prefixBits: 56 })
    expect(one).toBe('2001:db8:1:2a00::/56')
    expect(keyOfAddress({ address: '2001:db8:1:2aff::1', prefixBits: 56 })).toBe(one)
    expect(keyOfAddress({ address: '2001:db8:1:2b00::1', prefixBits: 56 })).not.toBe(one)
  })
})

describe('rateKeyOf', () => {
  it('counts a client behind the proxy by the address the proxy appended', async () => {
    await expect(
      keyOf({ ip: PROXY, headers: { [RAVEN_HEADERS.forwardedFor]: '10.0.0.5, 2001:db8:9:9::7' } }),
    ).resolves.toBe('2001:db8:9:9::/64')
  })

  it("counts a visitor of the Netlify site by their own address once Netlify's signature holds", async () => {
    const sign = await signed()
    await expect(
      keyOf({
        ip: PROXY,
        headers: {
          [NETLIFY_HEADERS.sign]: sign,
          [NETLIFY_HEADERS.clientAddress]: '203.0.113.7',
          [RAVEN_HEADERS.forwardedFor]: `203.0.113.7, ${NETLIFY}`,
        },
      }),
    ).resolves.toBe('203.0.113.7')
    await expect(
      keyOf({
        ip: PROXY,
        headers: {
          [NETLIFY_HEADERS.sign]: sign,
          [RAVEN_HEADERS.forwardedFor]: `198.51.100.1, 203.0.113.8, ${NETLIFY}`,
        },
      }),
    ).resolves.toBe('203.0.113.8')
  })

  it("believes no visitor address without Netlify's valid, unexpired signature", async () => {
    const forged = {
      [NETLIFY_HEADERS.clientAddress]: '203.0.113.7',
      [RAVEN_HEADERS.forwardedFor]: `203.0.113.7, ${NETLIFY}`,
    }
    const cases = await Promise.all([
      keyOf({ ip: PROXY, headers: forged }),
      keyOf({ ip: PROXY, headers: { ...forged, [NETLIFY_HEADERS.sign]: 'not.a.jws' } }),
      signed({ secret: OTHER }).then((sign) =>
        keyOf({ ip: PROXY, headers: { ...forged, [NETLIFY_HEADERS.sign]: sign } }),
      ),
      signed({ expiresIn: '-1m' }).then((sign) =>
        keyOf({ ip: PROXY, headers: { ...forged, [NETLIFY_HEADERS.sign]: sign } }),
      ),
      signed({ issuer: 'someone' }).then((sign) =>
        keyOf({ ip: PROXY, headers: { ...forged, [NETLIFY_HEADERS.sign]: sign } }),
      ),
      signed().then((sign) =>
        keyOf({
          ip: PROXY,
          headers: { ...forged, [NETLIFY_HEADERS.sign]: sign },
          proxySecret: null,
        }),
      ),
    ])
    expect(cases).toEqual(Array.from({ length: cases.length }, () => NETLIFY))
  })
})
