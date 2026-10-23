import { HEADERS } from '@shared/server'
import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import { CONTROLLERS } from '@/appModule'
import {
  CORS_FLAGS,
  CORS_HEADERS,
  mediaPlanePaths,
  pathMatcher,
  preflightHeaders,
  registerMediaPlaneCors,
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
      [CORS_HEADERS.allowOrigin]: ORIGIN,
      vary: 'Origin',
      [CORS_HEADERS.allowMethods]: 'GET, HEAD, OPTIONS',
      [CORS_HEADERS.allowHeaders]: HEADERS.range,
      [CORS_HEADERS.maxAge]: '600',
    })
  })

  it('adds the private network allowance when it was asked for', () => {
    expect(preflightHeaders({ origin: ORIGIN, wantsPrivateNetwork: true })).toEqual({
      [CORS_HEADERS.allowOrigin]: ORIGIN,
      vary: 'Origin',
      [CORS_HEADERS.allowMethods]: 'GET, HEAD, OPTIONS',
      [CORS_HEADERS.allowHeaders]: HEADERS.range,
      [CORS_HEADERS.maxAge]: '600',
      [CORS_HEADERS.allowPrivateNetwork]: CORS_FLAGS.true,
    })
  })
})

describe('responseHeaders', () => {
  it('names the origin and exposes the headers a player reads, with no credentials', () => {
    const headers = responseHeaders(ORIGIN)
    expect(headers).toEqual({
      [CORS_HEADERS.allowOrigin]: ORIGIN,
      vary: 'Origin',
      [CORS_HEADERS.exposeHeaders]: 'content-length, content-range, accept-ranges',
    })
    expect(Object.keys(headers)).not.toContain(CORS_HEADERS.allowCredentials)
  })
})

describe('mediaPlanePaths', () => {
  it('is the routes marked for the media plane', () => {
    expect(mediaPlanePaths(CONTROLLERS).toSorted()).toEqual([
      '/api/media-origins/ping',
      '/api/media/:id/file',
      '/api/media/:id/hls/:session/init',
      '/api/media/:id/hls/:session/segment/:n',
      '/api/media/:id/hls/:session/subtitles/:trackId',
      '/api/media/:id/hls/:session/subtitles/:trackId/:n',
      '/api/media/:id/hls/:session/video.m3u8',
      '/api/media/:id/hls/master.m3u8',
      '/api/media/:id/stream',
      '/api/media/:id/subtitles/:trackId',
    ])
  })
})

describe('registerMediaPlaneCors', () => {
  /** A route whose vary is already set when the hook runs, as compression or a controller would leave it. */
  const varyOf = async (
    existing: string | null,
  ): Promise<string | number | string[] | undefined> => {
    const fastify = Fastify()
    fastify.addHook('onRequest', async (_request, reply) => {
      if (existing !== null) reply.header(HEADERS.vary, existing)
    })
    registerMediaPlaneCors({
      fastify,
      isMediaPlanePath: pathMatcher(['/api/media/:id/file']),
      isAllowedOrigin: (origin) => origin === ORIGIN,
    })
    fastify.get('/api/media/:id/file', async () => 'bytes')
    const response = await fastify.inject({
      method: 'GET',
      url: '/api/media/1/file',
      headers: { origin: ORIGIN },
    })
    await fastify.close()
    return response.headers.vary
  }

  it('sets vary to Origin when the reply has none', async () => {
    expect(await varyOf(null)).toBe('Origin')
  })

  it('appends Origin to a vary the reply already has', async () => {
    expect(await varyOf(HEADERS.acceptEncoding)).toBe('accept-encoding, Origin')
  })

  it('does not list Origin twice', async () => {
    expect(await varyOf('Accept-Encoding, origin')).toBe('Accept-Encoding, origin')
  })
})
