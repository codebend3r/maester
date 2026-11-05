import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import { registerRequestLog, requestLogLine } from '@/requestLog'

describe('requestLogLine', () => {
  it('names the method, the path, the status and the whole milliseconds', () => {
    expect(
      requestLogLine({ method: 'GET', url: '/api/home', statusCode: 200, elapsedMs: 12.4 }),
    ).toBe('GET    /api/home 200 12ms')
  })

  it('leaves the query out, so a ticket in it is never logged', () => {
    const line = requestLogLine({
      method: 'GET',
      url: '/api/media/7/file?t=account.secret-ticket&x=1',
      statusCode: 206,
      elapsedMs: 3,
    })
    expect(line).toBe('GET    /api/media/7/file 206 3ms')
    expect(line).not.toContain('secret-ticket')
  })
})

describe('registerRequestLog', () => {
  it('logs each request once it is answered, misses included', async () => {
    const fastify = Fastify()
    const lines: string[] = []
    registerRequestLog({ fastify, log: (line) => lines.push(line) })
    fastify.get('/api/health', async () => ({ ok: true }))

    await fastify.inject({ method: 'GET', url: '/api/health?t=hls.capability' })
    await fastify.inject({ method: 'POST', url: '/api/nowhere' })

    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatch(/^GET {4}\/api\/health 200 \d+ms$/)
    expect(lines[1]).toMatch(/^POST {3}\/api\/nowhere 404 \d+ms$/)
    await fastify.close()
  })
})
