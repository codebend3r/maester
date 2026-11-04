import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import { registerRequestLog, requestLogLine } from '@/requestLog'

describe('requestLogLine', () => {
  it('names the method, the address, the status and the whole milliseconds', () => {
    expect(
      requestLogLine({ method: 'GET', url: '/api/home?x=1', statusCode: 200, elapsedMs: 12.4 }),
    ).toBe('GET    /api/home?x=1 200 12ms')
  })
})

describe('registerRequestLog', () => {
  it('logs each request once it is answered, misses included', async () => {
    const fastify = Fastify()
    const lines: string[] = []
    registerRequestLog({ fastify, log: (line) => lines.push(line) })
    fastify.get('/api/health', async () => ({ ok: true }))

    await fastify.inject({ method: 'GET', url: '/api/health' })
    await fastify.inject({ method: 'POST', url: '/api/nowhere' })

    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatch(/^GET {4}\/api\/health 200 \d+ms$/)
    expect(lines[1]).toMatch(/^POST {3}\/api\/nowhere 404 \d+ms$/)
    await fastify.close()
  })
})
