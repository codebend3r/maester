import { randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { MEDIA_PROBE_BYTES, type MediaOrigin, isMediaTicket } from '@raven/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '@/app'
import type { ServerConfig } from '@/config'
import { MediaIndex } from '@/media/mediaIndex'
import { ScannerService } from '@/scanner/scannerService'
import { NOT_WATCHING, adminCookie, cookieSet, cookies, testConfig } from '@/test/app'
import { encodeClip } from '@/test/clips'
import { apiFor } from '@/test/server'

const ORIGINS: MediaOrigin[] = [
  { kind: 'lan', url: 'https://raven.home.example' },
  { kind: 'tailnet', url: 'https://raven.tail.ts.net' },
]

const MIB = 1_048_576

const SIX_HOURS = 21_600_000

const mediaPlane = ({ secret }: { secret: Buffer | null }): ServerConfig['mediaPlane'] => ({
  origins: ORIGINS,
  webOrigins: [
    'https://raven-player.netlify.app',
    'https://deploy-preview-*--raven-player.netlify.app',
    'http://localhost:5173',
  ],
  secret,
  problems: [],
})

type Started = { app: NestFastifyApplication; admin: string; video: number }

describe('the media plane routes', () => {
  const state: { root: string; on: Started | null; off: Started | null } = {
    root: '',
    on: null,
    off: null,
  }
  const on = (): Started => {
    if (!state.on) throw new Error('app not started')
    return state.on
  }
  const off = (): Started => {
    if (!state.off) throw new Error('app not started')
    return state.off
  }

  const start = async ({
    name,
    secret,
    libraryPin,
  }: {
    name: string
    secret: Buffer | null
    libraryPin?: string
  }): Promise<Started> => {
    const media = join(state.root, name, 'media')
    await encodeClip({ path: join(media, 'Heat (1995).mp4'), seconds: 2 })
    const app = await createApp({
      config: {
        ...testConfig({
          dataDir: join(state.root, name, 'data'),
          mediaDir: join(state.root, name),
        }),
        mediaPlane: mediaPlane({ secret }),
        ...(libraryPin == null ? {} : { libraryPin }),
      },
      quiet: true,
      watch: NOT_WATCHING,
    })
    await app.init()
    const admin = await adminCookie(app)
    const created = await apiFor({ app, cookie: admin }).createLibrary({
      name: 'Films',
      paths: [media],
    })
    await app.get(ScannerService).whenIdle(created.id)
    const [video] = app.get(MediaIndex).idsForLibrary(created.id)
    if (video == null) throw new Error('the clip was not scanned')
    return { app, admin, video }
  }

  beforeAll(async () => {
    state.root = await mkdtemp(join(tmpdir(), 'raven-media-plane-'))
    state.on = await start({ name: 'on', secret: randomBytes(32), libraryPin: '2468' })
    state.off = await start({ name: 'off', secret: null })
  })

  afterAll(async () => {
    await state.on?.app.close()
    await state.off?.app.close()
    await rm(state.root, { recursive: true, force: true, maxRetries: 5 })
  })

  it('lists the media origins best first, uncached', async () => {
    const response = await on().app.inject({ method: 'GET', url: '/api/media-origins' })
    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.json()).toEqual({ origins: ORIGINS })
    await expect(apiFor({ app: on().app }).getMediaOrigins()).resolves.toEqual({
      origins: ORIGINS,
    })
  })

  it('answers the ping with the bytes asked for, capped at 1 MiB, from nothing on disk', async () => {
    const ping = (query: string) =>
      on().app.inject({ method: 'GET', url: `/api/media-origins/ping${query}` })
    const small = await ping('?bytes=1000')
    expect(small.statusCode).toBe(200)
    expect(small.headers['content-length']).toBe('1000')
    expect(small.headers['content-type']).toBe('application/octet-stream')
    expect(small.headers['cache-control']).toBe('no-store')
    expect(small.rawPayload).toHaveLength(1000)
    expect((await ping('?bytes=99999999')).headers['content-length']).toBe(String(MIB))
    expect((await ping('?bytes=0')).headers['content-length']).toBe('1')
    expect((await ping('?bytes=lots')).headers['content-length']).toBe(String(MEDIA_PROBE_BYTES))
    const plain = await ping('')
    expect(plain.headers['content-length']).toBe(String(MEDIA_PROBE_BYTES))
    expect(plain.rawPayload).toHaveLength(MEDIA_PROBE_BYTES)
  })

  it('does not compress the ping, though a browser offers to accept it', async () => {
    const response = await on().app.inject({
      method: 'GET',
      url: '/api/media-origins/ping?bytes=5000',
      headers: { 'accept-encoding': 'gzip, br' },
    })
    expect(response.headers['content-encoding']).toBeUndefined()
    expect(response.headers['content-length']).toBe('5000')
  })

  it('hands out a ticket for a video the browser may see, uncached', async () => {
    const before = Date.now()
    const response = await on().app.inject({
      method: 'GET',
      url: `/api/media/${on().video}/ticket`,
    })
    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    const body: unknown = response.json()
    expect(isMediaTicket(body)).toBe(true)
    const ticket = await apiFor({ app: on().app }).getMediaTicket(on().video)
    expect(Math.abs(ticket.expiresAt - (before + SIX_HOURS))).toBeLessThan(5_000)
  })

  it('answers 404 for a ticket for a video that is not there', async () => {
    const response = await on().app.inject({ method: 'GET', url: '/api/media/987654/ticket' })
    expect(response.statusCode).toBe(404)
  })

  it('lists no origins and answers 503 for a ticket when the secret is unusable', async () => {
    const client = apiFor({ app: off().app })
    await expect(client.getMediaOrigins()).resolves.toEqual({ origins: [] })
    const listed = await off().app.inject({ method: 'GET', url: '/api/media-origins' })
    expect(listed.headers['cache-control']).toBe('no-store')
    await expect(client.getMediaTicket(off().video)).rejects.toMatchObject({ status: 503 })
    const missing = await off().app.inject({ method: 'GET', url: '/api/media/987654/ticket' })
    expect(missing.statusCode).toBe(404)
  })

  it('holds back a ticket for a video in a library locked behind the PIN', async () => {
    const { app, admin } = on()
    const folder = join(state.root, 'on', 'private')
    await encodeClip({ path: join(folder, 'Lesson One.mp4'), seconds: 2 })
    const created = await apiFor({ app, cookie: admin }).createLibrary({
      name: 'Tutorials',
      paths: [folder],
      settings: { locked: true },
    })
    await app.get(ScannerService).whenIdle(created.id)
    const [locked] = app.get(MediaIndex).idsForLibrary(created.id)
    if (locked == null) throw new Error('the clip was not scanned')
    const ask = (cookie: string) =>
      app.inject({ method: 'GET', url: `/api/media/${locked}/ticket`, headers: { cookie } })
    expect((await ask(admin)).statusCode).toBe(423)
    const unlocked = await app.inject({
      method: 'POST',
      url: '/api/lock/unlock',
      payload: { pin: '2468' },
    })
    const response = await ask(cookies(admin, cookieSet(unlocked)))
    expect(response.statusCode).toBe(200)
    expect(isMediaTicket(response.json())).toBe(true)
  })
})
