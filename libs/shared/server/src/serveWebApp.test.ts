import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Controller, Get, Module } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { serveWebApp } from '@/serveWebApp'

@Controller('api')
class PingController {
  @Get('ping')
  ping(): { ok: boolean } {
    return { ok: true }
  }
}

@Module({ controllers: [PingController] })
class TestModule {}

const boot = async ({ webDir }: { webDir: string | null }): Promise<NestFastifyApplication> => {
  const app = await NestFactory.create<NestFastifyApplication>(TestModule, new FastifyAdapter(), {
    logger: false,
  })
  await serveWebApp({ app, webDir, serverPrefixes: ['/api/', '/internal/'] })
  await app.init()
  await app.getHttpAdapter().getInstance().ready()
  return app
}

describe('serveWebApp', () => {
  const state: { dir: string; app: NestFastifyApplication | null } = { dir: '', app: null }
  const app = (): NestFastifyApplication => {
    if (!state.app) throw new Error('The app is not booted')
    return state.app
  }

  beforeAll(async () => {
    state.dir = await mkdtemp(join(tmpdir(), 'shared-web-'))
    await mkdir(join(state.dir, 'assets'), { recursive: true })
    await writeFile(join(state.dir, 'index.html'), '<!doctype html><title>app</title>')
    await writeFile(join(state.dir, 'assets', 'app-1a2b.js'), 'console.log("app")')
    state.app = await boot({ webDir: state.dir })
  })

  afterAll(async () => {
    await state.app?.close()
    await rm(state.dir, { recursive: true, force: true })
  })

  it("answers a client route with the app's page, never cached", async () => {
    const page = await app().inject({ method: 'GET', url: '/library/3?view=grid' })
    expect(page.statusCode).toBe(200)
    expect(page.body).toContain('<title>app</title>')
    expect(page.headers['cache-control']).toBe('no-cache')
  })

  it('serves fingerprinted assets to be cached for good', async () => {
    const asset = await app().inject({ method: 'GET', url: '/assets/app-1a2b.js' })
    expect(asset.body).toBe('console.log("app")')
    expect(asset.headers['cache-control']).toContain('immutable')
  })

  it("keeps the server's own routes working", async () => {
    const ping = await app().inject({ method: 'GET', url: '/api/ping' })
    expect(ping.json()).toEqual({ ok: true })
  })

  it('answers a miss under any server prefix with a JSON 404', async () => {
    const misses = await Promise.all(
      ['/api/nope', '/internal/nope'].map((url) => app().inject({ method: 'GET', url })),
    )
    misses.forEach((miss) => {
      expect(miss.statusCode).toBe(404)
      expect(miss.headers['content-type']).toContain('application/json')
    })
  })

  it('answers anything but a GET with a JSON 404, client route or not', async () => {
    const miss = await app().inject({ method: 'POST', url: '/library/3', payload: {} })
    expect(miss.statusCode).toBe(404)
    expect(miss.headers['content-type']).toContain('application/json')
  })

  it('answers a client route with a JSON 404 when there is no web app to serve', async () => {
    const bare = await boot({ webDir: null })
    try {
      const miss = await bare.inject({ method: 'GET', url: '/library/3' })
      expect(miss.statusCode).toBe(404)
      expect(miss.headers['content-type']).toContain('application/json')
    } finally {
      await bare.close()
    }
  })
})
