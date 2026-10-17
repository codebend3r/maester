import { describe, expect, it } from 'vitest'
import { CONTROLLERS } from '@/appModule'
import {
  mediaPlanePaths,
  pathMatcher,
  preflightHeaders,
  responseHeaders,
} from '@/media/mediaPlaneCors'

const ORIGIN = 'https://raven-player.netlify.app'

describe('pathMatcher', () => {
  const matches = pathMatcher(['/api/media/:id/stream', '/api/media-origins/ping'])

  it('matches a path with its parameter filled, with or without a query', () => {
    expect(matches('/api/media/12/stream')).toBe(true)
    expect(matches('/api/media/12/stream?mode=remux&t=abc.def')).toBe(true)
    expect(matches('/api/media-origins/ping?bytes=10')).toBe(true)
  })

  it('matches nothing longer, shorter, empty in a segment or elsewhere', () => {
    expect(matches('/api/media/12/stream/x')).toBe(false)
    expect(matches('/api/media//stream')).toBe(false)
    expect(matches('/api/media/12/tracks')).toBe(false)
    expect(matches('/api/media/12')).toBe(false)
    expect(matches('/x/api/media/12/stream')).toBe(false)
    expect(matches('/api/media-origins/pings')).toBe(false)
  })

  it('takes a dot in a literal segment as a dot', () => {
    expect(pathMatcher(['/a.b/:id'])('/axb/1')).toBe(false)
    expect(pathMatcher(['/a.b/:id'])('/a.b/1')).toBe(true)
  })
})

describe('preflightHeaders', () => {
  it('allows the origin, GET, HEAD and OPTIONS with a range header, for ten minutes', () => {
    expect(preflightHeaders({ origin: ORIGIN, wantsPrivateNetwork: false })).toEqual({
      'access-control-allow-origin': ORIGIN,
      vary: 'Origin',
      'access-control-allow-methods': 'GET, HEAD, OPTIONS',
      'access-control-allow-headers': 'range',
      'access-control-max-age': '600',
    })
  })

  it('adds the private network allowance when it was asked for', () => {
    expect(preflightHeaders({ origin: ORIGIN, wantsPrivateNetwork: true })).toEqual({
      'access-control-allow-origin': ORIGIN,
      vary: 'Origin',
      'access-control-allow-methods': 'GET, HEAD, OPTIONS',
      'access-control-allow-headers': 'range',
      'access-control-max-age': '600',
      'access-control-allow-private-network': 'true',
    })
  })
})

describe('responseHeaders', () => {
  it('names the origin and exposes the headers a player reads, with no credentials', () => {
    const headers = responseHeaders(ORIGIN)
    expect(headers).toEqual({
      'access-control-allow-origin': ORIGIN,
      vary: 'Origin',
      'access-control-expose-headers': 'content-length, content-range, accept-ranges',
    })
    expect(Object.keys(headers)).not.toContain('access-control-allow-credentials')
  })
})

describe('mediaPlanePaths', () => {
  it('is the four routes marked for the media plane', () => {
    expect(mediaPlanePaths(CONTROLLERS).toSorted()).toEqual([
      '/api/media-origins/ping',
      '/api/media/:id/file',
      '/api/media/:id/stream',
      '/api/media/:id/subtitles/:trackId',
    ])
  })
})
