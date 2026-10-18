import { spyOn } from 'bun:test'
import { AUTH_CONFIG_STATES, AUTH_COOKIE } from '@raven/core'
import type { ReadyAuthConfig } from '@/lib/authClient'

export const readyConfig: ReadyAuthConfig = {
  state: AUTH_CONFIG_STATES.ready,
  supabaseUrl: 'http://127.0.0.1:54321',
  publishableKey: 'sb_publishable_test',
  webUrl: 'http://localhost:8484',
  cookieName: AUTH_COOKIE,
}

const encode = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url')

/** A session Supabase accepts as a sign in answer; `padding` grows it past one cookie. */
export const sessionOf = ({ padding }: { padding: number }) => {
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

export const answer = ({ body, status }: { body: unknown; status: number }) =>
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

/** happy-dom leaves an entry with an empty value behind a removed cookie, so only values count. */
export const heldCookies = () => authCookies().filter((cookie) => cookie.value !== '')

export const clearCookies = (): void =>
  document.cookie
    .split(';')
    .map((entry) => entry.trim().split('=')[0])
    .forEach((name) => {
      document.cookie = `${name}=; Path=/; Max-Age=0`
    })
