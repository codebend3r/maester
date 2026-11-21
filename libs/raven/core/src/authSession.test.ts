import { describe, expect, it } from 'bun:test'
import { hasSessionCookie } from '@/authSession'
import { AUTH_COOKIE } from '@/contract'

describe('hasSessionCookie', () => {
  it.each([
    { name: 'the session cookie', cookies: `theme=dusk; ${AUTH_COOKIE}=base64-abc` },
    { name: 'a session split into chunks', cookies: `${AUTH_COOKIE}.0=x; ${AUTH_COOKIE}.1=y` },
  ])('finds $name', ({ cookies }) => {
    expect(hasSessionCookie({ cookies, cookieName: AUTH_COOKIE })).toBe(true)
  })

  it.each([
    { name: 'no cookie at all', cookies: '' },
    { name: 'other cookies only', cookies: 'theme=dusk; raven_unlock=1' },
    { name: 'a cookie whose name only starts alike', cookies: `${AUTH_COOKIE}-old=x` },
  ])('finds none with $name', ({ cookies }) => {
    expect(hasSessionCookie({ cookies, cookieName: AUTH_COOKIE })).toBe(false)
  })
})
