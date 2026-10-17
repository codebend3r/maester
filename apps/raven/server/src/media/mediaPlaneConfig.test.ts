import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  isAllowedWebOrigin,
  MEDIA_PLANE_ENV,
  parseMediaOrigins,
  parseWebOrigins,
  readMediaPlaneConfig,
  readMediaSecret,
} from '@/media/mediaPlaneConfig'

describe('parseMediaOrigins', () => {
  it('reads kind:url entries best first and keeps their order', () => {
    expect(
      parseMediaOrigins('lan:https://raven.home.example.com, tailnet:https://raven.tail.ts.net')
        .origins,
    ).toEqual([
      { kind: 'lan', url: 'https://raven.home.example.com' },
      { kind: 'tailnet', url: 'https://raven.tail.ts.net' },
    ])
  })

  it('strips a trailing slash and drops a path, a query, an unknown kind or a missing kind, naming each', () => {
    const parsed = parseMediaOrigins(
      'lan:https://a.example/,lan:https://a.example/api,vpn:https://b.example,https://c.example',
    )
    expect(parsed.origins).toEqual([{ kind: 'lan', url: 'https://a.example' }])
    expect(parsed.problems).toHaveLength(3)
    expect(parsed.problems[0]).toContain('lan:https://a.example/api')
    expect(parsed.problems[1]).toBe(
      'RAVEN_MEDIA_ORIGINS entry "vpn:https://b.example" has an unknown kind; use lan, tailnet or public.',
    )
    expect(parsed.problems[2]).toContain('https://c.example')
  })

  it('drops a query and a fragment', () => {
    const parsed = parseMediaOrigins('lan:https://a.example?x=1,lan:https://a.example#top')
    expect(parsed.origins).toEqual([])
    expect(parsed.problems).toHaveLength(2)
  })

  it('drops an http origin unless its host is localhost', () => {
    expect(parseMediaOrigins('lan:http://192.168.1.2:8484').origins).toEqual([])
    expect(parseMediaOrigins('lan:http://192.168.1.2:8484').problems).toHaveLength(1)
    expect(parseMediaOrigins('lan:http://localhost:8484').origins).toEqual([
      { kind: 'lan', url: 'http://localhost:8484' },
    ])
  })

  it('drops text that is not a url', () => {
    const parsed = parseMediaOrigins('lan:raven.home')
    expect(parsed.origins).toEqual([])
    expect(parsed.problems).toHaveLength(1)
  })

  it('is empty for unset or blank', () => {
    expect(parseMediaOrigins(undefined)).toEqual({ origins: [], problems: [] })
    expect(parseMediaOrigins('  ')).toEqual({ origins: [], problems: [] })
  })
})

describe('parseWebOrigins and isAllowedWebOrigin', () => {
  it('keeps exact https origins and http://localhost, and drops the rest', () => {
    const parsed = parseWebOrigins(
      'https://raven-player.netlify.app,http://localhost:5173,http://evil.example,https://x.example/path',
    )
    expect(parsed.origins).toEqual(['https://raven-player.netlify.app', 'http://localhost:5173'])
    expect(parsed.problems).toHaveLength(2)
    expect(parsed.problems[0]).toContain('http://evil.example')
    expect(parsed.problems[1]).toContain('https://x.example/path')
  })

  it('matches an exact origin and nothing near it', () => {
    const allowed = parseWebOrigins('https://raven-player.netlify.app').origins
    expect(isAllowedWebOrigin({ origin: 'https://raven-player.netlify.app', allowed })).toBe(true)
    expect(isAllowedWebOrigin({ origin: 'http://raven-player.netlify.app', allowed })).toBe(false)
    expect(
      isAllowedWebOrigin({ origin: 'https://raven-player.netlify.app.evil.example', allowed }),
    ).toBe(false)
  })

  it('matches a * as exactly one first label', () => {
    const allowed = parseWebOrigins('https://*--raven-player.netlify.app').origins
    expect(allowed).toHaveLength(1)
    expect(
      isAllowedWebOrigin({
        origin: 'https://deploy-preview-12--raven-player.netlify.app',
        allowed,
      }),
    ).toBe(true)
    expect(isAllowedWebOrigin({ origin: 'https://a.b--raven-player.netlify.app', allowed })).toBe(
      false,
    )
    expect(isAllowedWebOrigin({ origin: 'https://raven-player.netlify.app', allowed })).toBe(false)
    expect(isAllowedWebOrigin({ origin: 'https://--raven-player.netlify.app', allowed })).toBe(
      false,
    )
  })

  it('matches a * inside the first label ahead of a literal tail', () => {
    const allowed = parseWebOrigins('https://deploy-preview-*--raven-player.netlify.app').origins
    expect(
      isAllowedWebOrigin({
        origin: 'https://deploy-preview-12--raven-player.netlify.app',
        allowed,
      }),
    ).toBe(true)
    expect(
      isAllowedWebOrigin({ origin: 'https://deploy-preview---raven-player.netlify.app', allowed }),
    ).toBe(false)
  })

  it('refuses a * anywhere but as the first label', () => {
    const parsed = parseWebOrigins(
      'https://raven-*.netlify.app,https://a.*.netlify.app,https://*.netlify.app',
    )
    expect(parsed.origins).toEqual(['https://*.netlify.app'])
    expect(parsed.problems).toHaveLength(2)
    expect(parsed.problems[0]).toContain('https://raven-*.netlify.app')
    expect(parsed.problems[1]).toContain('https://a.*.netlify.app')
  })

  it('never matches a missing origin or "null"', () => {
    const allowed = parseWebOrigins(
      'https://*.netlify.app,https://raven-player.netlify.app',
    ).origins
    expect(isAllowedWebOrigin({ origin: undefined, allowed })).toBe(false)
    expect(isAllowedWebOrigin({ origin: '', allowed })).toBe(false)
    expect(isAllowedWebOrigin({ origin: 'null', allowed })).toBe(false)
  })

  it('compares the port', () => {
    const allowed = parseWebOrigins('http://localhost:5173').origins
    expect(isAllowedWebOrigin({ origin: 'http://localhost:5173', allowed })).toBe(true)
    expect(isAllowedWebOrigin({ origin: 'http://localhost:4173', allowed })).toBe(false)
    expect(isAllowedWebOrigin({ origin: 'http://localhost', allowed })).toBe(false)
  })

  it('is empty for unset or blank', () => {
    expect(parseWebOrigins(undefined)).toEqual({ origins: [], problems: [] })
    expect(parseWebOrigins(' ')).toEqual({ origins: [], problems: [] })
  })
})

describe('readMediaSecret', () => {
  it('decodes base64 of 32 bytes or more', () => {
    const bytes = randomBytes(32)
    const parsed = readMediaSecret(bytes.toString('base64'))
    expect(parsed.problems).toEqual([])
    expect(parsed.secret?.equals(bytes)).toBe(true)
    expect(readMediaSecret(randomBytes(48).toString('base64url')).secret?.length).toBe(48)
  })

  it('refuses fewer than 32 bytes, non-base64 text, unset and blank, with a problem', () => {
    const cases = [
      randomBytes(31).toString('base64'),
      'this is not base64 at all!',
      undefined,
      '   ',
    ]
    cases.forEach((value) => {
      const parsed = readMediaSecret(value)
      expect(parsed.secret).toBeNull()
      expect(parsed.problems).toHaveLength(1)
      expect(parsed.problems[0]).toContain(MEDIA_PLANE_ENV.secret)
    })
  })

  it('never puts the secret in a problem', () => {
    const value = randomBytes(31).toString('base64')
    expect(readMediaSecret(value).problems.join(' ')).not.toContain(value)
  })
})

describe('readMediaPlaneConfig', () => {
  const secret = randomBytes(32).toString('base64')

  it('is empty when nothing is set', () => {
    expect(readMediaPlaneConfig({})).toEqual({
      origins: [],
      webOrigins: [],
      secret: null,
      problems: [],
    })
  })

  it('adds a problem and keeps no origins when origins are set without a usable secret', () => {
    const config = readMediaPlaneConfig({
      RAVEN_MEDIA_ORIGINS: 'lan:https://a.example,vpn:https://b.example',
      RAVEN_WEB_ORIGINS: 'https://raven-player.netlify.app',
      RAVEN_MEDIA_SECRET: 'short',
    })
    expect(config.origins).toEqual([])
    expect(config.secret).toBeNull()
    expect(config.webOrigins).toEqual(['https://raven-player.netlify.app'])
    expect(config.problems).toHaveLength(2)
    expect(config.problems.some((problem) => problem.includes('vpn:https://b.example'))).toBe(true)
    expect(config.problems.some((problem) => problem.includes('RAVEN_MEDIA_SECRET'))).toBe(true)
  })

  it('names the missing secret when origins are set without one', () => {
    const config = readMediaPlaneConfig({ RAVEN_MEDIA_ORIGINS: 'lan:https://a.example' })
    expect(config.origins).toEqual([])
    expect(config.problems).toHaveLength(1)
    expect(config.problems[0]).toContain('RAVEN_MEDIA_SECRET')
  })

  it('keeps origins and secret together when both are usable', () => {
    const config = readMediaPlaneConfig({
      RAVEN_MEDIA_ORIGINS: 'lan:https://a.example',
      RAVEN_WEB_ORIGINS: 'https://*.netlify.app',
      RAVEN_MEDIA_SECRET: secret,
    })
    expect(config.origins).toEqual([{ kind: 'lan', url: 'https://a.example' }])
    expect(config.webOrigins).toEqual(['https://*.netlify.app'])
    expect(config.secret?.length).toBe(32)
    expect(config.problems).toEqual([])
  })

  it('names a secret that is set but unusable even without origins', () => {
    const config = readMediaPlaneConfig({ RAVEN_MEDIA_SECRET: 'short' })
    expect(config.secret).toBeNull()
    expect(config.problems).toHaveLength(1)
  })
})
