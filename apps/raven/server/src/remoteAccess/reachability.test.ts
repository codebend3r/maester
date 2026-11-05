import { createHmac } from 'node:crypto'
import {
  DEFAULT_REMOTE_ACCESS_SETTINGS,
  REMOTE_ACCESS_STATES,
  type RemoteAccessSettings,
  readReachabilityQuery,
} from '@raven/core'
import { describe, expect, it, vi } from 'vitest'
import type { ServerConfig } from '@/config'
import { type ReachabilityFetch, Reachability, checkSignatureOf } from '@/remoteAccess/reachability'
import { testConfig } from '@/test/app'
import { manualClock } from '@/test/clock'

const SECRET = 'a-proxy-secret-of-at-least-32-characters'
const CHECK_URL = 'https://raven-player.netlify.app/remote-access/check'
const HOSTNAME = 'raven.example.synology.me'

const SETTINGS: RemoteAccessSettings = {
  ...DEFAULT_REMOTE_ACCESS_SETTINGS,
  isEnabled: true,
  hostname: HOSTNAME,
  publicPort: 8443,
}

const SEEN = { publicAddress: '203.0.113.9', resolved: ['203.0.113.9'] }

type ReachabilityForProps = { checkUrl?: string | null; proxySecret?: string | null }

const reachabilityFor = ({ checkUrl = CHECK_URL, proxySecret = SECRET }: ReachabilityForProps) => {
  const base = testConfig({ dataDir: '/nowhere', mediaDir: '/nowhere' })
  const config: ServerConfig = {
    ...base,
    remoteAccess: {
      ...base.remoteAccess,
      checkUrl,
      proxySecret: proxySecret === null ? null : new TextEncoder().encode(proxySecret),
    },
  }
  const fetch = vi.fn<ReachabilityFetch>(async () =>
    Response.json({ state: REMOTE_ACCESS_STATES.reachable, ...SEEN }),
  )
  return { reachability: new Reachability(config, manualClock().clock, fetch), fetch }
}

describe('checkSignatureOf', () => {
  it('is the HMAC-SHA256 of the nonce in lower case hex', () => {
    // RFC 4231's well known example, so the function's own HMAC can be checked against it.
    expect(
      checkSignatureOf({
        nonce: 'The quick brown fox jumps over the lazy dog',
        proxySecret: new TextEncoder().encode('key'),
      }),
    ).toBe('f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8')
  })
})

describe('Reachability', () => {
  it("signs each check's nonce with the proxy secret, in the query the function reads", async () => {
    const { reachability, fetch } = reachabilityFor({})
    const status = await reachability.statusOf({ settings: SETTINGS, isFresh: true })
    expect(status).toMatchObject({ state: REMOTE_ACCESS_STATES.reachable, ...SEEN })
    const url = fetch.mock.calls[0]?.[0].url ?? ''
    expect(url.startsWith(`${CHECK_URL}?`)).toBe(true)
    const query = readReachabilityQuery(new URL(url).search)
    expect(query).toMatchObject({ host: HOSTNAME, port: 8443 })
    const nonce = query?.nonce ?? ''
    expect(query?.signature).toBe(createHmac('sha256', SECRET).update(nonce).digest('hex'))
  })

  it('sends no unsigned check: without the proxy secret, or the site, it can not check', async () => {
    const unsigned = reachabilityFor({ proxySecret: null })
    const siteless = reachabilityFor({ checkUrl: null })
    await expect(
      unsigned.reachability.statusOf({ settings: SETTINGS, isFresh: true }),
    ).resolves.toEqual({ state: REMOTE_ACCESS_STATES.unchecked })
    await expect(
      siteless.reachability.statusOf({ settings: SETTINGS, isFresh: true }),
    ).resolves.toEqual({ state: REMOTE_ACCESS_STATES.unchecked })
    expect(unsigned.fetch).not.toHaveBeenCalled()
    expect(siteless.fetch).not.toHaveBeenCalled()
  })

  it('says off or unconfigured before it looks at the check', async () => {
    const { reachability, fetch } = reachabilityFor({ proxySecret: null })
    await expect(
      reachability.statusOf({ settings: { ...SETTINGS, isEnabled: false }, isFresh: true }),
    ).resolves.toEqual({ state: REMOTE_ACCESS_STATES.disabled })
    await expect(
      reachability.statusOf({ settings: { ...SETTINGS, publicPort: null }, isFresh: true }),
    ).resolves.toEqual({ state: REMOTE_ACCESS_STATES.unconfigured })
    expect(fetch).not.toHaveBeenCalled()
  })
})
