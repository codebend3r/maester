import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { AUTH_CONFIG_STATES, AUTH_COOKIE } from '@raven/core'
import { AUTH_ERRORS, createAuthClient, type ReadyAuthConfig } from '@/lib/authClient'

const config: ReadyAuthConfig = {
  state: AUTH_CONFIG_STATES.ready,
  supabaseUrl: 'http://127.0.0.1:54321',
  publishableKey: 'sb_publishable_test',
  webUrl: 'http://localhost:8484',
  cookieName: AUTH_COOKIE,
}

const encode = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url')

const sessionOf = ({ padding }: { padding: number }) => {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600
  const claims = { sub: 'u1', exp: expiresAt, aud: 'authenticated', role: 'authenticated' }
  return {
    access_token: `${encode({ alg: 'HS256' })}.${encode(claims)}.signature`,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: expiresAt,
    refresh_token: 'refresh',
    user: {
      id: 'u1',
      aud: 'authenticated',
      email: 'a@example.com',
      user_metadata: { padding: 'x'.repeat(padding) },
      app_metadata: {},
      created_at: '2026-10-18T00:00:00Z',
    },
  }
}

const answer = ({ body, status }: { body: unknown; status: number }) =>
  spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      async () =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        }),
      { preconnect: () => undefined },
    ),
  )

const authCookies = () =>
  document.cookie
    .split(';')
    .map((entry) => entry.trim().split('='))
    .flatMap(([name, ...value]) =>
      name?.startsWith(AUTH_COOKIE) ? [{ name, value: value.join('=') }] : [],
    )

const heldCookies = () => authCookies().filter((cookie) => cookie.value !== '')

const credentials = { email: 'a@example.com', password: 'password' }

const written: string[] = []

const descriptorOf = ({
  target,
  key,
}: {
  target: object | null
  key: string
}): PropertyDescriptor | undefined => {
  if (target == null) return undefined
  return (
    Object.getOwnPropertyDescriptor(target, key) ??
    descriptorOf({ target: Object.getPrototypeOf(target), key })
  )
}
const cookieDescriptor = descriptorOf({ target: document, key: 'cookie' })

beforeEach(() => {
  written.length = 0
  if (cookieDescriptor?.get == null || cookieDescriptor.set == null) return
  const { get, set } = cookieDescriptor
  Object.defineProperty(document, 'cookie', {
    configurable: true,
    get: () => get.call(document),
    set: (value: string) => {
      written.push(value)
      set.call(document, value)
    },
  })
})

afterEach(() => {
  Reflect.deleteProperty(document, 'cookie')
  document.cookie
    .split(';')
    .map((entry) => entry.trim().split('=')[0])
    .forEach((name) => {
      document.cookie = `${name}=; Path=/; Max-Age=0`
    })
  spyOn(globalThis, 'fetch').mockRestore()
})

describe('createAuthClient', () => {
  it('keeps a small session in one host-only maester-auth cookie', async () => {
    answer({ body: sessionOf({ padding: 0 }), status: 200 })
    const client = createAuthClient({ config })
    const { error } = await client.signInWithPassword(credentials)
    expect(error).toBeNull()
    expect(heldCookies().map((cookie) => cookie.name)).toEqual([AUTH_COOKIE])
    expect(document.cookie).not.toContain('sb-')
    expect(heldCookies()[0]?.value.startsWith('base64-')).toBe(true)
    expect(written.length).toBeGreaterThan(0)
    written.forEach((cookie) => {
      expect(cookie.toLowerCase()).not.toContain('domain=')
      expect(cookie).toContain('Path=/')
      expect(cookie).toContain('SameSite=Lax')
    })
    await client.signOut()
  })

  it('leaves no value in any maester-auth cookie after sign out', async () => {
    answer({ body: sessionOf({ padding: 0 }), status: 200 })
    const client = createAuthClient({ config })
    await client.signInWithPassword(credentials)
    await client.signOut()
    expect(heldCookies()).toEqual([])
  })

  it('splits a session over one cookie into chunks and removes every one on sign out', async () => {
    answer({ body: sessionOf({ padding: 6000 }), status: 200 })
    const client = createAuthClient({ config })
    await client.signInWithPassword(credentials)
    const names = heldCookies().map((cookie) => cookie.name)
    expect(names.length).toBeGreaterThan(1)
    expect(names).toEqual(names.map((_name, index) => `${AUTH_COOKIE}.${index}`))
    expect(document.cookie).not.toContain('sb-')
    await client.signOut()
    expect(heldCookies()).toEqual([])
  })

  it('reports Supabase refusals under the codes the screens branch on', async () => {
    answer({
      body: {
        code: 400,
        error_code: AUTH_ERRORS.invalidCredentials,
        msg: 'Invalid login credentials',
      },
      status: 400,
    })
    const client = createAuthClient({ config })
    const { error } = await client.signInWithPassword(credentials)
    expect(error?.code).toBe(AUTH_ERRORS.invalidCredentials)
    expect(heldCookies()).toEqual([])
  })
})
