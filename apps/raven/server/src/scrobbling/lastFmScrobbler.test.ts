import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { readServerConfig } from '@/config'
import {
  LASTFM_AUTH_PAGE,
  LASTFM_PARAMS,
  LastFmScrobbler,
  signed,
} from '@/scrobbling/lastFmScrobbler'
import { SEND_OUTCOMES } from '@/scrobbling/scrobbler'
import { FAKE_LASTFM_KEYS, fakeLastFm } from '@/test/fakeLastFm'

const LISTEN = {
  listenedAt: 1_793_000_000,
  artist: 'Radiohead',
  track: 'Airbag',
  album: 'OK Computer',
  durationSeconds: 284.4,
  recordingMbid: null,
  releaseMbid: null,
}

describe('LastFmScrobbler', () => {
  it("signs a call as Last.fm's docs spell it: names sorted, name then value, the secret, md5", () => {
    const params = { token: 'tok', method: 'auth.getSession', api_key: 'key', format: 'json' }
    expect(
      signed({ params, keys: { apiKey: 'key', apiSecret: 'secret' } })[LASTFM_PARAMS.apiSig],
    ).toBe(createHash('md5').update('api_keykeymethodauth.getSessiontokentoksecret').digest('hex'))
  })

  it("sends the account to Last.fm's page with raven's key and the callback", () => {
    const lastFm = new LastFmScrobbler(
      { ...readServerConfig({}), lastFm: FAKE_LASTFM_KEYS },
      fakeLastFm().fetch,
    )
    const page = new URL(lastFm.authPage({ callback: 'https://raven.example.test/cb?state=s' }))
    expect(`${page.origin}${page.pathname}`).toBe(LASTFM_AUTH_PAGE)
    expect(page.searchParams.get('api_key')).toBe(FAKE_LASTFM_KEYS.apiKey)
    expect(page.searchParams.get(LASTFM_PARAMS.callback)).toBe(
      'https://raven.example.test/cb?state=s',
    )
  })

  it('trades a sign-in token once for a session, and sends with it', async () => {
    const fake = fakeLastFm({ tokens: { once: 'rj' } })
    const lastFm = new LastFmScrobbler(
      { ...readServerConfig({}), lastFm: FAKE_LASTFM_KEYS },
      fake.fetch,
    )
    const session = await lastFm.validate({ token: 'once' })
    expect(session).toEqual({ username: 'rj', secret: 'session-of-once' })
    await expect(lastFm.validate({ token: 'once' })).resolves.toBeNull()
    await expect(lastFm.send({ secret: session?.secret ?? '', listen: LISTEN })).resolves.toBe(
      SEND_OUTCOMES.sent,
    )
    expect(fake.scrobbles).toEqual([expect.objectContaining({ duration: '284', track: 'Airbag' })])
    await expect(lastFm.send({ secret: 'gone', listen: LISTEN })).resolves.toBe(
      SEND_OUTCOMES.unlinked,
    )
    fake.setScrobbleError({ error: 16 })
    await expect(lastFm.send({ secret: session?.secret ?? '', listen: LISTEN })).resolves.toBe(
      SEND_OUTCOMES.retry,
    )
  })

  it('is off without both keys', () => {
    const off = new LastFmScrobbler({ ...readServerConfig({}), lastFm: null }, fakeLastFm().fetch)
    expect(off.isAvailable()).toBe(false)
    expect(() => off.authPage({ callback: 'https://raven.example.test' })).toThrow()
  })
})
