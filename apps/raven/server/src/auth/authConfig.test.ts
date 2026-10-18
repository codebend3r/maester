import { AUTH_CONFIG_STATES, AUTH_COOKIE } from '@raven/core'
import { describe, expect, it } from 'vitest'
import { AUTH_ENV, readAuthConfig } from '@/auth/authConfig'

const env = {
  [AUTH_ENV.url]: 'https://project.supabase.co',
  [AUTH_ENV.key]: 'sb_publishable_example',
  [AUTH_ENV.webUrl]: 'https://raven.example.test',
} as const

describe('raven auth configuration', () => {
  it('is off with no configuration and exposes no credentials', () => {
    expect(readAuthConfig({})).toEqual({ state: AUTH_CONFIG_STATES.off })
  })

  it('publishes only the connection settings needed by clients', () => {
    expect(readAuthConfig(env)).toEqual({
      state: AUTH_CONFIG_STATES.ready,
      supabaseUrl: env[AUTH_ENV.url],
      publishableKey: env[AUTH_ENV.key],
      webUrl: env[AUTH_ENV.webUrl],
      cookieName: AUTH_COOKIE,
    })
  })

  it.each([
    { [AUTH_ENV.url]: env[AUTH_ENV.url] },
    { ...env, [AUTH_ENV.url]: 'http://project.supabase.co' },
    { ...env, [AUTH_ENV.webUrl]: 'https://user:password@raven.example.test' },
    { ...env, [AUTH_ENV.webUrl]: 'https://raven.example.test/path' },
    { ...env, [AUTH_ENV.webUrl]: 'https://raven.example.test?redirect=elsewhere' },
    { ...env, [AUTH_ENV.webUrl]: 'https://raven.example.test#fragment' },
    { ...env, [AUTH_ENV.key]: 'sb_secret_never_publish_this' },
    { ...env, [AUTH_ENV.key]: 'legacy-or-service-role-jwt' },
    { ...env, [AUTH_ENV.url]: 'not a URL' },
  ])('fails closed for partial or unsafe configuration: %o', (input) => {
    expect(readAuthConfig(input)).toEqual({ state: AUTH_CONFIG_STATES.unavailable })
  })

  it('permits HTTP only on loopback for local development', () => {
    expect(
      readAuthConfig({
        ...env,
        [AUTH_ENV.url]: 'http://127.0.0.1:54321',
        [AUTH_ENV.webUrl]: 'http://localhost:5173/',
      }),
    ).toMatchObject({ state: AUTH_CONFIG_STATES.ready, webUrl: 'http://localhost:5173' })
    expect(readAuthConfig({ ...env, [AUTH_ENV.url]: 'http://localhost.attacker.test' })).toEqual({
      state: AUTH_CONFIG_STATES.unavailable,
    })
  })
})
