import { describe, expect, it } from 'bun:test'
import { SAME_SITE, parseCookies, readCookie, serializeCookie } from '@/cookies'

describe('parseCookies', () => {
  it('lists every pair in order, trimmed, duplicates kept, and skips a part with no equals sign', () => {
    expect(parseCookies({ header: ' a=1; flag ;b = 2 ;a=3' })).toEqual([
      { name: 'a', value: '1' },
      { name: 'b', value: '2' },
      { name: 'a', value: '3' },
    ])
  })

  it('is empty with no header', () => {
    expect(parseCookies({ header: undefined })).toEqual([])
  })
})

describe('readCookie', () => {
  it('finds a cookie among others, spaces and all', () => {
    expect(readCookie({ header: 'a=1;  session=abc.def ; b=2', name: 'session' })).toBe('abc.def')
  })

  it('matches the whole name, not a cookie that only starts with it', () => {
    expect(readCookie({ header: 'session_old=stale; session=fresh', name: 'session' })).toBe(
      'fresh',
    )
  })

  it('keeps everything after the first equals sign', () => {
    expect(readCookie({ header: 'token=a=b==', name: 'token' })).toBe('a=b==')
  })

  it('is null with no header, no such cookie, or an empty value', () => {
    expect(readCookie({ header: undefined, name: 'session' })).toBeNull()
    expect(readCookie({ header: 'other=1', name: 'session' })).toBeNull()
    expect(readCookie({ header: 'session=; other=1', name: 'session' })).toBeNull()
  })
})

describe('serializeCookie', () => {
  it('names every attribute it is given', () => {
    expect(
      serializeCookie({
        name: 'session',
        value: 'abc',
        path: '/',
        maxAgeSeconds: 60,
        domain: 'example.com',
        sameSite: SAME_SITE.lax,
        isSecure: true,
      }),
    ).toBe('session=abc; Path=/; Max-Age=60; Domain=example.com; HttpOnly; SameSite=Lax; Secure')
  })

  it('leaves out Max-Age for a session cookie, and Domain and Secure when not asked', () => {
    expect(
      serializeCookie({
        name: 'unlock',
        value: '',
        path: '/api',
        maxAgeSeconds: null,
        domain: null,
        sameSite: SAME_SITE.strict,
        isSecure: false,
      }),
    ).toBe('unlock=; Path=/api; HttpOnly; SameSite=Strict')
  })
})
