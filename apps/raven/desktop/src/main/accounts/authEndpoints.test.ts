import { describe, expect, it } from 'bun:test'
import { AUTH_CONFIG_STATES, AUTH_COOKIE } from '@raven/core'
import { signInConfigOf, signInOriginOf } from '@/main/accounts/authEndpoints'

const READY = {
  state: AUTH_CONFIG_STATES.ready,
  supabaseUrl: 'https://project.supabase.co',
  publishableKey: 'sb_publishable_example',
  webUrl: 'https://raven.example.test',
  cookieName: AUTH_COOKIE,
} as const

describe('signInOriginOf', () => {
  it.each([
    ['https://project.supabase.co', 'https://project.supabase.co'],
    ['https://project.supabase.co/', 'https://project.supabase.co'],
    ['https://raven.example.test:8443', 'https://raven.example.test:8443'],
    ['HTTPS://Raven.Example.Test', 'https://raven.example.test'],
    ['http://localhost:54321', 'http://localhost:54321'],
    ['http://127.0.0.1:54321', 'http://127.0.0.1:54321'],
    ['http://[::1]:54321', 'http://[::1]:54321'],
  ])('accepts %s as %s', (value, origin) => {
    expect(signInOriginOf(value)).toBe(origin)
  })

  it.each([
    'http://project.supabase.co',
    'http://192.168.1.10:54321',
    'http://localhost.evil.test',
    'ftp://project.supabase.co',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'https://user:password@raven.example.test',
    'https://user@raven.example.test',
    'https://raven.example.test/path',
    'https://raven.example.test/auth/v1',
    'https://raven.example.test?redirect=elsewhere',
    'https://raven.example.test/?x=1',
    'https://raven.example.test#fragment',
    'not a URL',
    '',
    '//raven.example.test',
  ])('refuses %s', (value) => {
    expect(signInOriginOf(value)).toBeNull()
  })
})

describe('signInConfigOf', () => {
  it('keeps the endpoints of a ready config as origins', () => {
    expect(signInConfigOf({ ...READY, webUrl: 'https://raven.example.test/' })).toEqual({
      supabaseUrl: 'https://project.supabase.co',
      publishableKey: 'sb_publishable_example',
      webUrl: 'https://raven.example.test',
    })
  })

  it('has nothing for a server whose accounts are off or unavailable', () => {
    expect(signInConfigOf({ state: AUTH_CONFIG_STATES.off })).toBeNull()
    expect(signInConfigOf({ state: AUTH_CONFIG_STATES.unavailable })).toBeNull()
  })

  it.each([
    { supabaseUrl: 'http://project.supabase.co' },
    { supabaseUrl: 'https://project.supabase.co/rest' },
    { webUrl: 'https://user:pw@raven.example.test' },
    { webUrl: 'javascript:alert(1)' },
    { publishableKey: 'sb_secret_never_publish_this' },
    { publishableKey: 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2ln' },
    { publishableKey: 'sb_publishable_' },
    { publishableKey: 'sb_publishable_has space' },
  ])('refuses endpoints raven player cannot use: %o', (change) => {
    expect(signInConfigOf({ ...READY, ...change })).toBeNull()
  })
})
