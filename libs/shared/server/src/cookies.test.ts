import { describe, expect, it } from 'vitest'
import { readCookie } from '@/cookies'

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
