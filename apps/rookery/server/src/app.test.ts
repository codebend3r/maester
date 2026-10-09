import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp } from '@/app.js'
import { addMs } from '@/clock.js'
import { type ServerConfig, readServerConfig } from '@/config.js'
import { DatabaseService } from '@/db/database.js'
import type { PlexAccount, PlexPin } from '@/plex/plexTv.js'
import { hashToken } from '@/sessions/sessionsRepository.js'
import { FakePlexTv } from '@/test/fakePlexTv.js'

const ROOKERY = 'https://rookery.maester.example.com'
const LUWIN = 'https://luwin.maester.example.com'
const SERVICE_TOKEN = 'service-s3cret'
const START = new Date('2026-10-09T12:00:00.000Z')
const MINUTE = 60 * 1000
const DAY = 24 * 60 * MINUTE

const alice: PlexAccount = {
  id: '1001',
  username: 'alice',
  email: 'alice@example.com',
  thumb: 'https://plex.tv/users/1001/avatar',
}

type Injected = Awaited<ReturnType<NestFastifyApplication['inject']>>

type Harness = {
  app: NestFastifyApplication
  plex: FakePlexTv
  clock: { now: Date }
  root: string
}

const harnesses: Harness[] = []

afterEach(async () => {
  await Promise.all(
    harnesses.splice(0).map(async ({ app, root }) => {
      await app.close()
      await rm(root, { recursive: true, force: true })
    }),
  )
})

const boot = async ({
  publicUrl = ROOKERY,
  cookieDomain = null,
  webDir = null,
}: {
  publicUrl?: string
  cookieDomain?: string | null
  webDir?: string | null
} = {}): Promise<Harness> => {
  const root = await mkdtemp(join(tmpdir(), 'rookery-app-'))
  const config: ServerConfig = {
    ...readServerConfig({ PUBLIC_URL: publicUrl, SERVICE_TOKEN }),
    dataDir: join(root, 'data'),
    webDir,
    cookieDomain,
    appOrigins: [LUWIN],
    pinCheckDelayMs: 0,
  }
  const plex = new FakePlexTv()
  const clock = { now: START }
  const app = await createApp({ config, plexTv: plex, clock: () => clock.now, quiet: true })
  await app.init()
  await app.getHttpAdapter().getInstance().ready()
  const harness = { app, plex, clock, root }
  harnesses.push(harness)
  return harness
}

const setCookies = (response: Injected): string[] => {
  const header = response.headers['set-cookie']
  return header == null ? [] : Array.isArray(header) ? header : [String(header)]
}

const cookieNamed = ({ response, name }: { response: Injected; name: string }): string => {
  const found = setCookies(response).find((cookie) => cookie.startsWith(`${name}=`))
  if (!found) throw new Error(`no ${name} cookie in ${JSON.stringify(setCookies(response))}`)
  return found
}

const valueOf = (cookie: string): string =>
  cookie.slice(cookie.indexOf('=') + 1).split(';')[0] ?? ''

const start = async ({ harness, returnTo }: { harness: Harness; returnTo?: string }) => {
  const response = await harness.app.inject({
    method: 'POST',
    url: '/api/auth/plex/start',
    payload: returnTo == null ? {} : { return_to: returnTo },
  })
  const pin = harness.plex.pins.at(-1)
  return { response, pin }
}

const callback = ({ harness, pinCookie }: { harness: Harness; pinCookie: string | null }) =>
  harness.app.inject({
    method: 'GET',
    url: '/auth/plex/callback',
    headers: pinCookie ? { cookie: `rookery_pin=${pinCookie}` } : {},
  })

/** A full sign-in as `account`; returns the callback's response and the session token. */
const signIn = async ({
  harness,
  account = alice,
  returnTo = `${LUWIN}/`,
}: {
  harness: Harness
  account?: PlexAccount
  returnTo?: string
}) => {
  const started = await start({ harness, returnTo })
  const pin: PlexPin | undefined = started.pin
  if (!pin) throw new Error('no PIN created')
  harness.plex.approve({ pin, account })
  const response = await callback({
    harness,
    pinCookie: valueOf(cookieNamed({ response: started.response, name: 'rookery_pin' })),
  })
  const token = valueOf(cookieNamed({ response, name: 'maester_session' }))
  return { response, token }
}

const me = ({ harness, token }: { harness: Harness; token: string }) =>
  harness.app.inject({
    method: 'GET',
    url: '/api/me',
    headers: { cookie: `other=1; maester_session=${token}` },
  })

const lookup = ({
  harness,
  token,
  bearer = SERVICE_TOKEN,
}: {
  harness: Harness
  token?: unknown
  bearer?: string | null
}) =>
  harness.app.inject({
    method: 'POST',
    url: '/internal/session',
    headers: bearer == null ? {} : { authorization: `Bearer ${bearer}` },
    payload: token === undefined ? {} : { token },
  })

const db = (harness: Harness) => harness.app.get(DatabaseService).db

const count = ({ harness, table }: { harness: Harness; table: string }): number =>
  Number(db(harness).prepare(`SELECT COUNT(*) FROM ${table}`).pluck().get())

describe('starting a sign-in', () => {
  it('opens a PIN, remembers the sign-in, and sends the browser to Plex', async () => {
    const harness = await boot()
    const { response, pin } = await start({ harness, returnTo: `${LUWIN}/chat` })

    expect(response.statusCode).toBe(200)
    const body = response.json<{ auth_url: string }>()
    expect(body).toEqual({ auth_url: expect.stringMatching(/^https:\/\/app\.plex\.tv\/auth#\?/) })
    // Plex's auth app reads its parameters from the fragment.
    const authUrl = new URL(body.auth_url.replace('#?', '?'))
    expect(authUrl.searchParams.get('clientID')).toBe('maester')
    expect(authUrl.searchParams.get('code')).toBe(pin?.code ?? 'no pin')
    expect(authUrl.searchParams.get('context[device][product]')).toBe('maester')
    expect(authUrl.searchParams.get('forwardUrl')).toBe(`${ROOKERY}/auth/plex/callback`)

    const cookie = cookieNamed({ response, name: 'rookery_pin' })
    expect(cookie).toContain('Path=/auth/plex')
    expect(cookie).toContain('Max-Age=900')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).toContain('Secure')
    expect(cookie).not.toContain('Domain=')
    expect(count({ harness, table: 'pending_sign_ins' })).toBe(1)
  })

  it('answers 503 when plex.tv is down', async () => {
    const harness = await boot()
    harness.plex.down = true
    const { response } = await start({ harness })
    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({ reason: 'plex_unavailable' })
  })

  it('prunes sign-ins left unfinished for 15 minutes', async () => {
    const harness = await boot()
    await start({ harness })
    harness.clock.now = addMs({ date: START, ms: 16 * MINUTE })
    await start({ harness })
    expect(count({ harness, table: 'pending_sign_ins' })).toBe(1)
  })
})

describe('the Plex callback', () => {
  it('signs in, sets the session cookie, and returns to the app', async () => {
    const harness = await boot()
    const { response, token } = await signIn({ harness, returnTo: `${LUWIN}/chat` })

    expect(response.statusCode).toBe(303)
    expect(response.headers.location).toBe(`${LUWIN}/chat`)
    const cookie = cookieNamed({ response, name: 'maester_session' })
    expect(cookie).toContain('Path=/')
    expect(cookie).toContain(`Max-Age=${30 * 24 * 60 * 60}`)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).toContain('Secure')
    expect(cookie).not.toContain('Domain=')
    expect(cookieNamed({ response, name: 'rookery_pin' })).toContain('Max-Age=0')
    expect(count({ harness, table: 'pending_sign_ins' })).toBe(0)

    const stored = db(harness).prepare('SELECT token_hash FROM sessions').pluck().all()
    expect(stored).toEqual([hashToken(token)])
    expect(stored).not.toContain(token)

    const who = await me({ harness, token })
    expect(who.statusCode).toBe(200)
    expect(who.json()).toEqual({
      user: {
        id: expect.any(String),
        display_name: 'alice',
        email: 'alice@example.com',
        thumb: alice.thumb,
      },
    })
  })

  it('shares the cookie across COOKIE_DOMAIN, and drops Secure over plain http', async () => {
    const harness = await boot({
      publicUrl: 'http://localhost:5180',
      cookieDomain: 'maester.example.com',
    })
    const { response } = await signIn({ harness })
    const cookie = cookieNamed({ response, name: 'maester_session' })
    expect(cookie).toContain('Domain=maester.example.com')
    expect(cookie).not.toContain('Secure')
  })

  it('keeps one user per Plex account and refreshes what Plex says about it', async () => {
    const harness = await boot()
    const first = await signIn({ harness })
    const second = await signIn({ harness, account: { ...alice, username: 'alice2' } })

    type Me = { user: { id: string; display_name: string } }
    const firstUser = (await me({ harness, token: first.token })).json<Me>()
    const secondUser = (await me({ harness, token: second.token })).json<Me>()
    expect(secondUser.user.display_name).toBe('alice2')
    expect(firstUser.user.id).toBe(secondUser.user.id)
    expect(count({ harness, table: 'users' })).toBe(1)
    expect(count({ harness, table: 'logins' })).toBe(1)
  })

  it('waits for a token that trails the redirect', async () => {
    const harness = await boot()
    const { response, pin } = await start({ harness })
    if (!pin) throw new Error('no PIN created')
    harness.plex.approve({ pin, account: alice, afterChecks: 2 })
    const done = await callback({
      harness,
      pinCookie: valueOf(cookieNamed({ response, name: 'rookery_pin' })),
    })
    expect(done.headers.location).toBe('/')
    expect(cookieNamed({ response: done, name: 'maester_session' })).toBeTruthy()
    expect(harness.plex.checksOf(pin)).toBe(3)
  })

  it('sends a sign-in Plex never approved back to /login', async () => {
    const harness = await boot()
    const { response, pin } = await start({ harness, returnTo: `${LUWIN}/chat` })
    const done = await callback({
      harness,
      pinCookie: valueOf(cookieNamed({ response, name: 'rookery_pin' })),
    })
    expect(done.statusCode).toBe(303)
    expect(done.headers.location).toBe(
      `/login?error=not_approved&return_to=${encodeURIComponent(`${LUWIN}/chat`)}`,
    )
    expect(pin && harness.plex.checksOf(pin)).toBe(5)
    expect(setCookies(done).some((cookie) => cookie.startsWith('maester_session='))).toBe(false)
  })

  it('calls a missing or stale sign-in expired', async () => {
    const harness = await boot()
    expect((await callback({ harness, pinCookie: null })).headers.location).toBe(
      '/login?error=expired',
    )
    const { response } = await start({ harness })
    harness.clock.now = addMs({ date: START, ms: 16 * MINUTE })
    const done = await callback({
      harness,
      pinCookie: valueOf(cookieNamed({ response, name: 'rookery_pin' })),
    })
    expect(done.headers.location).toBe('/login?error=expired')
  })

  it('reports plex.tv failing mid-sign-in', async () => {
    const harness = await boot()
    const { response } = await start({ harness })
    harness.plex.down = true
    const done = await callback({
      harness,
      pinCookie: valueOf(cookieNamed({ response, name: 'rookery_pin' })),
    })
    expect(done.headers.location).toBe('/login?error=plex_unavailable')
  })

  it('prunes expired sessions when a new one is made', async () => {
    const harness = await boot()
    await signIn({ harness })
    harness.clock.now = addMs({ date: START, ms: 31 * DAY })
    await signIn({ harness })
    expect(count({ harness, table: 'sessions' })).toBe(1)
  })
})

describe('signing out', () => {
  it('ends the session, clears the cookie on the same domain, and validates next', async () => {
    const harness = await boot({ cookieDomain: 'maester.example.com' })
    const { token } = await signIn({ harness })

    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie: `maester_session=${token}` },
      payload: { return_to: `${LUWIN}/` },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ next: `${LUWIN}/` })
    const cleared = cookieNamed({ response, name: 'maester_session' })
    expect(cleared).toContain('Max-Age=0')
    expect(cleared).toContain('Domain=maester.example.com')

    expect((await me({ harness, token })).statusCode).toBe(401)
    expect((await lookup({ harness, token })).statusCode).toBe(404)
  })

  it('sends a foreign return_to to /login', async () => {
    const harness = await boot()
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      payload: { return_to: 'https://evil.example/' },
    })
    expect(response.json()).toEqual({ next: '/login' })
  })

  it('refuses a write that is not JSON', async () => {
    const harness = await boot()
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { 'content-type': 'text/plain' },
      payload: '{}',
    })
    expect(response.statusCode).toBe(415)
    expect(response.json()).toEqual({ reason: 'json_required' })
  })
})

describe('/api/me', () => {
  it('is 401 without a session, and never cached', async () => {
    const harness = await boot()
    const response = await harness.app.inject({ method: 'GET', url: '/api/me' })
    expect(response.statusCode).toBe(401)
    expect(response.json()).toEqual({ reason: 'signed_out' })
    expect(response.headers['cache-control']).toBe('no-store')
  })
})

describe('the internal session lookup', () => {
  it('needs the service token', async () => {
    const harness = await boot()
    const { token } = await signIn({ harness })
    expect((await lookup({ harness, token, bearer: null })).statusCode).toBe(401)
    expect((await lookup({ harness, token, bearer: 'wrong' })).statusCode).toBe(401)
    expect((await lookup({ harness })).statusCode).toBe(400)
  })

  it('says who a live session belongs to', async () => {
    const harness = await boot()
    const { token } = await signIn({ harness })
    const response = await lookup({ harness, token })
    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.json()).toEqual({
      user: {
        id: expect.any(String),
        display_name: 'alice',
        email: 'alice@example.com',
        thumb: alice.thumb,
      },
      plex: { id: '1001', username: 'alice', email: 'alice@example.com' },
      expires_at: addMs({ date: START, ms: 30 * DAY }).toISOString(),
    })
  })

  it('tells unknown from expired', async () => {
    const harness = await boot()
    const { token } = await signIn({ harness })
    const unknown = await lookup({ harness, token: 'not-a-session' })
    expect(unknown.statusCode).toBe(404)
    expect(unknown.json()).toEqual({ reason: 'unknown' })

    harness.clock.now = addMs({ date: START, ms: 30 * DAY })
    const expired = await lookup({ harness, token })
    expect(expired.statusCode).toBe(404)
    expect(expired.json()).toEqual({ reason: 'expired' })
  })

  it('moves last_seen_at at most once a minute', async () => {
    const harness = await boot()
    const { token } = await signIn({ harness })
    const lastSeen = () => db(harness).prepare('SELECT last_seen_at FROM sessions').pluck().get()

    harness.clock.now = addMs({ date: START, ms: 30 * 1000 })
    await lookup({ harness, token })
    expect(lastSeen()).toBe(START.toISOString())

    harness.clock.now = addMs({ date: START, ms: 61 * 1000 })
    await lookup({ harness, token })
    expect(lastSeen()).toBe(harness.clock.now.toISOString())
  })
})

describe('serving the web app', () => {
  it('answers client routes with index.html and keeps API 404s as JSON', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rookery-web-'))
    await mkdir(join(root, 'assets'), { recursive: true })
    await writeFile(join(root, 'index.html'), '<!doctype html><title>rookery</title>')
    await writeFile(join(root, 'assets', 'app.js'), 'console.log("rookery")')
    const harness = await boot({ webDir: root })
    try {
      const page = await harness.app.inject({ method: 'GET', url: '/login?error=expired' })
      expect(page.statusCode).toBe(200)
      expect(page.body).toContain('<title>rookery</title>')

      const asset = await harness.app.inject({ method: 'GET', url: '/assets/app.js' })
      expect(asset.body).toBe('console.log("rookery")')

      const missing = await harness.app.inject({ method: 'GET', url: '/api/nope' })
      expect(missing.statusCode).toBe(404)
      expect(missing.headers['content-type']).toContain('application/json')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('answers /health without a session', async () => {
    const harness = await boot()
    const response = await harness.app.inject({ method: 'GET', url: '/health' })
    expect(response.json()).toEqual({ status: 'ok' })
  })
})
