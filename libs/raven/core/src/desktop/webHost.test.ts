import { describe, expect, it } from 'bun:test'
import {
  DEFAULT_LINK_ORIGINS,
  DEFAULT_SERVER_ORIGIN,
  DESKTOP_ENV,
  isUnreachableAnswer,
  PAGE_ORIGIN,
  WEB_HOST,
  WEB_HOST_ERRORS,
  WEB_HOST_PORT,
} from '@/desktop/webHost'

describe('the web host', () => {
  it('serves the page from localhost on its fixed port', () => {
    expect(WEB_HOST_PORT).toBe(47484)
    expect(WEB_HOST).toBe('localhost:47484')
    expect(PAGE_ORIGIN).toBe('http://localhost:47484')
  })

  it('names the unreachable server error the page reads', () => {
    expect(WEB_HOST_ERRORS).toEqual({ serverUnreachable: 'server_unreachable' })
  })

  it('reads its unreachable answer and nothing else as one', () => {
    const own = { error: WEB_HOST_ERRORS.serverUnreachable }
    expect(isUnreachableAnswer({ status: 200, body: own })).toBe(true)
    expect(isUnreachableAnswer({ status: 502, body: { error: 'bad_gateway' } })).toBe(false)
    expect(isUnreachableAnswer({ status: 200, body: null })).toBe(false)
  })

  it("takes a gateway status with no JSON as a proxy's, and anything with JSON as the server's", () => {
    expect(isUnreachableAnswer({ status: 502, body: null })).toBe(true)
    expect(isUnreachableAnswer({ status: 503, body: null })).toBe(true)
    expect(isUnreachableAnswer({ status: 504, body: null })).toBe(true)
    expect(isUnreachableAnswer({ status: 500, body: null })).toBe(false)
    expect(isUnreachableAnswer({ status: 503, body: { reason: 'unavailable' } })).toBe(false)
    expect(isUnreachableAnswer({ status: 502, body: { error: 'server_unreachable' } })).toBe(true)
  })

  it('names the build environment and its fallback server', () => {
    expect(DESKTOP_ENV).toEqual({
      serverOrigin: 'RAVEN_DESKTOP_SERVER_ORIGIN',
      linkOrigins: 'RAVEN_DESKTOP_LINK_ORIGINS',
    })
    expect(DEFAULT_SERVER_ORIGIN).toBe('https://vhagar2.synology.me:8443')
  })

  it("names the web app's site as the default server's built-in link origin", () => {
    expect(DEFAULT_LINK_ORIGINS).toEqual(['https://raven-player.netlify.app'])
    expect(DEFAULT_LINK_ORIGINS).not.toContain(DEFAULT_SERVER_ORIGIN)
  })
})
