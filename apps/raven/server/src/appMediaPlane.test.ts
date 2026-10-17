import { randomBytes } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { MEDIA_PROBE_BYTES, type MediaOrigin, isMediaTicket } from '@raven/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '@/app'
import type { ServerConfig } from '@/config'
import { MediaIndex } from '@/media/mediaIndex'
import { MediaTickets } from '@/media/mediaTickets'
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

const NETLIFY = 'https://raven-player.netlify.app'

const SIDECAR = ['1', '00:00:00,200 --> 00:00:01,000', 'Hello', ''].join('\n')

const EXPOSED = 'content-length, content-range, accept-ranges'

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

  describe('across origins', () => {
    const vault: { locked: number | null } = { locked: null }
    const locked = (): number => {
      if (vault.locked == null) throw new Error('library not made')
      return vault.locked
    }

    const unlocked = async (): Promise<string> => {
      const { app, admin } = on()
      const response = await app.inject({
        method: 'POST',
        url: '/api/lock/unlock',
        payload: { pin: '2468' },
      })
      return cookies(admin, cookieSet(response))
    }

    const ticketFor = async (id: number): Promise<string> => {
      const response = await on().app.inject({
        method: 'GET',
        url: `/api/media/${id}/ticket`,
        headers: { cookie: await unlocked() },
      })
      expect(response.statusCode).toBe(200)
      const body: unknown = response.json()
      if (!isMediaTicket(body)) throw new Error('not a ticket')
      return body.ticket
    }

    const asBrowser = ({
      url,
      origin = NETLIFY,
      headers = {},
    }: {
      url: string
      origin?: string
      headers?: Record<string, string>
    }) => on().app.inject({ method: 'GET', url, headers: { origin, ...headers } })

    beforeAll(async () => {
      const { app, admin } = on()
      const folder = join(state.root, 'on', 'vault')
      await encodeClip({ path: join(folder, 'Vault (2001).mp4'), seconds: 2 })
      await writeFile(join(folder, 'Vault (2001).en.srt'), SIDECAR)
      const created = await apiFor({ app, cookie: admin }).createLibrary({
        name: 'Vault',
        paths: [folder],
        settings: { locked: true },
      })
      await app.get(ScannerService).whenIdle(created.id)
      const [id] = app.get(MediaIndex).idsForLibrary(created.id)
      if (id == null) throw new Error('the clip was not scanned')
      vault.locked = id
    })

    const preflight = ({
      origin,
      privateNetwork = false,
    }: {
      origin: string
      privateNetwork?: boolean
    }) =>
      on().app.inject({
        method: 'OPTIONS',
        url: `/api/media/${on().video}/stream`,
        headers: {
          origin,
          'access-control-request-method': 'GET',
          ...(privateNetwork ? { 'access-control-request-private-network': 'true' } : {}),
        },
      })

    it('answers the preflight for an allowed origin, with the private network allowance when asked', async () => {
      const response = await preflight({ origin: NETLIFY, privateNetwork: true })
      expect(response.statusCode).toBe(204)
      expect(response.headers).toMatchObject({
        'access-control-allow-origin': NETLIFY,
        vary: 'Origin',
        'access-control-allow-methods': 'GET, HEAD, OPTIONS',
        'access-control-allow-headers': 'range',
        'access-control-max-age': '600',
        'access-control-allow-private-network': 'true',
      })
      expect(response.headers['access-control-allow-credentials']).toBeUndefined()
      expect(response.body).toBe('')
      const plain = await preflight({ origin: NETLIFY })
      expect(plain.statusCode).toBe(204)
      expect(plain.headers['access-control-allow-private-network']).toBeUndefined()
    })

    it('answers the preflight for a deploy preview and for localhost', async () => {
      const origins = [
        'https://deploy-preview-42--raven-player.netlify.app',
        'http://localhost:5173',
      ]
      const responses = await Promise.all(origins.map((origin) => preflight({ origin })))
      expect(responses.map(({ statusCode }) => statusCode)).toEqual([204, 204])
      expect(responses.map(({ headers }) => headers['access-control-allow-origin'])).toEqual(
        origins,
      )
    })

    it('answers the preflight for the other media plane routes, and for no other', async () => {
      const ask = (url: string) =>
        on().app.inject({
          method: 'OPTIONS',
          url,
          headers: { origin: NETLIFY, 'access-control-request-method': 'GET' },
        })
      const video = on().video
      const open = await Promise.all(
        [
          '/api/media-origins/ping?bytes=10',
          `/api/media/${video}/file`,
          `/api/media/${video}/subtitles/external-0`,
        ].map(ask),
      )
      expect(open.map(({ statusCode }) => statusCode)).toEqual([204, 204, 204])
      const shut = await Promise.all(
        [`/api/media/${video}`, `/api/media/${video}/ticket`, '/api/media-origins'].map(ask),
      )
      expect(shut.map(({ headers }) => headers['access-control-allow-origin'])).toEqual([
        undefined,
        undefined,
        undefined,
      ])
    })

    it('gives a foreign origin no CORS headers at all, on the preflight and on the stream', async () => {
      const foreign = await preflight({ origin: 'https://evil.example' })
      expect(foreign.statusCode).toBe(404)
      expect(
        Object.keys(foreign.headers).filter((name) => name.startsWith('access-control')),
      ).toEqual([])
      const ticket = await ticketFor(locked())
      const stream = await asBrowser({
        url: `/api/media/${locked()}/file?t=${ticket}`,
        origin: 'https://evil.example',
        headers: { range: 'bytes=0-99' },
      })
      expect(stream.statusCode).toBe(206)
      expect(
        Object.keys(stream.headers).filter((name) => name.startsWith('access-control')),
      ).toEqual([])
      expect(stream.headers.vary).toBeUndefined()
    })

    it("plays a locked library's stream cross-origin with a ticket and no cookie, with CORS headers", async () => {
      const ticket = await ticketFor(locked())
      const stream = await asBrowser({
        url: `/api/media/${locked()}/stream?mode=remux&t=${ticket}`,
      })
      expect(stream.statusCode).toBe(200)
      expect(stream.rawPayload.subarray(4, 8).toString()).toBe('ftyp')
      const file = await asBrowser({
        url: `/api/media/${locked()}/file?t=${ticket}`,
        headers: { range: 'bytes=0-99' },
      })
      expect(file.statusCode).toBe(206)
      expect(file.headers['content-range']).toMatch(/^bytes 0-99\//)
      const subtitles = await asBrowser({
        url: `/api/media/${locked()}/subtitles/external-0?t=${ticket}`,
      })
      expect(subtitles.statusCode).toBe(200)
      expect(subtitles.body).toContain('Hello')
      const ping = await asBrowser({ url: '/api/media-origins/ping?bytes=10' })
      expect(ping.statusCode).toBe(200)
      ;[stream, file, subtitles, ping].forEach((response) => {
        expect(response.headers['access-control-allow-origin']).toBe(NETLIFY)
        expect(response.headers.vary).toContain('Origin')
        expect(response.headers['access-control-expose-headers']).toBe(EXPOSED)
        expect(response.headers['access-control-allow-credentials']).toBeUndefined()
      })
    })

    it('adds Origin to a vary the response already has', async () => {
      const ticket = await ticketFor(locked())
      const response = await asBrowser({
        url: `/api/media/${locked()}/subtitles/external-0?t=${ticket}`,
        headers: { 'accept-encoding': 'gzip' },
      })
      const vary = String(response.headers.vary).split(/,\s*/)
      expect(vary).toContain('Origin')
      expect(vary.filter((name) => name === 'Origin')).toHaveLength(1)
    })

    it('refuses the stream with a ticket for another video, an expired one and a tampered one (423)', async () => {
      const { app, admin, video } = on()
      const tickets = app.get(MediaTickets)
      const good = await ticketFor(locked())
      const tampered = `${good.slice(0, -1)}${good.endsWith('A') ? 'B' : 'A'}`
      const refused = await Promise.all(
        [
          tickets.issue({ id: video }).ticket,
          tickets.issue({ id: locked(), now: Date.now() - 7 * 3_600_000 }).ticket,
          tampered,
          '',
        ].map((ticket) =>
          asBrowser({
            url: `/api/media/${locked()}/stream?mode=remux&t=${ticket}`,
            headers: { cookie: admin },
          }),
        ),
      )
      expect(refused.map(({ statusCode }) => statusCode)).toEqual([423, 423, 423, 423])
      refused.forEach((response) => {
        expect(response.headers['access-control-allow-origin']).toBe(NETLIFY)
        expect(response.headers['access-control-expose-headers']).toBe(EXPOSED)
      })
      const underAdminLock = await asBrowser({
        url: `/api/media/${locked()}/stream?mode=remux&t=${tampered}`,
      })
      expect(underAdminLock.statusCode).toBe(404)
    })

    it('opens nothing else with a ticket: /api/media/:id and /api/media/:id/ticket stay 423', async () => {
      const ticket = await ticketFor(locked())
      const { admin } = on()
      const paths = [
        `/api/media/${locked()}`,
        `/api/media/${locked()}/ticket`,
        `/api/media/${locked()}/tracks`,
      ]
      const responses = await Promise.all(
        paths.map((path) => asBrowser({ url: `${path}?t=${ticket}`, headers: { cookie: admin } })),
      )
      expect(responses.map(({ statusCode }) => statusCode)).toEqual(paths.map(() => 423))
    })

    it('leaves a same-origin stream with the cookie as it was', async () => {
      const response = await on().app.inject({
        method: 'GET',
        url: `/api/media/${locked()}/stream?mode=remux`,
        headers: { cookie: await unlocked() },
      })
      expect(response.statusCode).toBe(200)
      expect(response.rawPayload.subarray(4, 8).toString()).toBe('ftyp')
      expect(
        Object.keys(response.headers).filter((name) => name.startsWith('access-control')),
      ).toEqual([])
      expect(response.headers.vary).toBeUndefined()
    })
  })
})
