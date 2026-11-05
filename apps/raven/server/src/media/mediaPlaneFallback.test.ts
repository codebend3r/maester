import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import { pathMatcher, registerMediaPlaneHook } from '@/media/mediaPlaneCors'
import { proxiedMediaWarner, proxiedMediaWarning } from '@/media/mediaPlaneFallback'

const WEB_ORIGIN = 'https://raven-player.netlify.app'

type ServerWithProps = { hasMediaOrigins?: boolean }

const serverWith = ({ hasMediaOrigins = false }: ServerWithProps = {}) => {
  const warn = vi.fn()
  const fastify = Fastify()
  registerMediaPlaneHook({
    fastify,
    isMediaPlanePath: pathMatcher(['/api/media/:id/stream', '/api/media-origins/ping']),
    isAllowedOrigin: (origin) => origin === WEB_ORIGIN,
    onProxied: proxiedMediaWarner({ hasMediaOrigins, warn }),
  })
  fastify.get('/api/media/:id/stream', async () => 'bytes')
  fastify.get('/api/media/:id/tracks', async () => [])
  fastify.get('/api/media-origins/ping', async () => 'noise')
  return { fastify, warn }
}

describe('proxiedMediaWarner', () => {
  it('warns once per web origin when a media route is fetched through its proxy', async () => {
    const { fastify, warn } = serverWith()
    const headers = { referer: `${WEB_ORIGIN}/watch/12` }
    await fastify.inject({ url: '/api/media/12/stream?mode=remux', headers })
    await fastify.inject({ url: '/api/media/13/stream', headers })
    await fastify.inject({ method: 'HEAD', url: '/api/media/13/stream', headers })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(
      proxiedMediaWarning({ webOrigin: WEB_ORIGIN, hasMediaOrigins: false }),
    )
    expect(warn.mock.calls[0]?.[0]).toContain('RAVEN_MEDIA_ORIGINS is unset')
  })

  it('names the probe when media origins are set but none was picked', async () => {
    const { fastify, warn } = serverWith({ hasMediaOrigins: true })
    await fastify.inject({ url: '/api/media/12/stream', headers: { referer: `${WEB_ORIGIN}/` } })
    expect(warn.mock.calls[0]?.[0]).toContain('reached none of RAVEN_MEDIA_ORIGINS')
  })

  it('stays quiet for a direct request, a cross-origin one, another route or a foreign referer', async () => {
    const { fastify, warn } = serverWith()
    await fastify.inject({ url: '/api/media/12/stream' })
    await fastify.inject({
      url: '/api/media/12/stream?t=abc',
      headers: { origin: WEB_ORIGIN, referer: `${WEB_ORIGIN}/` },
    })
    await fastify.inject({ url: '/api/media/12/tracks', headers: { referer: `${WEB_ORIGIN}/` } })
    await fastify.inject({
      url: '/api/media/12/stream',
      headers: { referer: 'https://raven.example.com:8443/watch/12' },
    })
    await fastify.inject({ url: '/api/media/12/stream', headers: { referer: 'not a url' } })
    await fastify.inject({
      method: 'POST',
      url: '/api/media/12/stream',
      headers: { referer: `${WEB_ORIGIN}/` },
    })
    expect(warn).not.toHaveBeenCalled()
  })
})
