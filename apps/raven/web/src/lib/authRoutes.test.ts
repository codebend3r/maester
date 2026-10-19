import { describe, expect, it } from 'bun:test'
import {
  AUTH_QUERY,
  AUTH_ROUTES,
  checkEmailPath,
  confirmUrl,
  safeReturnPath,
  signInPath,
} from '@/lib/authRoutes'

describe('safeReturnPath', () => {
  it.each([
    ['a protocol-relative URL', '//evil.example'],
    ['a backslash after the slash', '/\\evil.example'],
    ['a backslash later on', '/libraries\\3'],
    ['an absolute URL', 'https://evil.example'],
    ['a javascript URL', 'javascript:alert(1)'],
    ['a newline', '/libraries/3\n/evil'],
    ['a carriage return', '/libraries/3\r'],
    ['a tab', '/\t/evil.example'],
    ['a NUL', '/libraries\u0000'],
    ['a DEL', '/libraries\u007f'],
    ['no leading slash', 'libraries/3'],
    ['an empty string', ''],
  ])('sends %s home', (_name, value) => {
    expect(safeReturnPath(value)).toBe('/')
  })

  it('sends a missing value home', () => {
    expect(safeReturnPath(null)).toBe('/')
  })

  it.each(Object.values(AUTH_ROUTES))('sends the auth route %s home', (route) => {
    expect(safeReturnPath(route)).toBe('/')
    expect(safeReturnPath(`${route}?x=1`)).toBe('/')
    expect(safeReturnPath(`${route}#y`)).toBe('/')
    expect(safeReturnPath(`${route}/`)).toBe('/')
  })

  it('sends an auth route home whatever its case', () => {
    expect(safeReturnPath('/Sign-In')).toBe('/')
  })

  it('sends the confirm route home with its query', () => {
    expect(safeReturnPath('/auth/confirm?x=1')).toBe('/')
  })

  it('keeps a path that only starts like an auth route', () => {
    expect(safeReturnPath('/sign-in-help')).toBe('/sign-in-help')
    expect(safeReturnPath('/libraries/3?next=/sign-in')).toBe('/libraries/3?next=/sign-in')
  })

  it('keeps a same-origin path with its query and hash', () => {
    expect(safeReturnPath('/libraries/3?x=1#y')).toBe('/libraries/3?x=1#y')
  })

  it('keeps the root', () => {
    expect(safeReturnPath('/')).toBe('/')
  })
})

describe('signInPath', () => {
  it('carries the return path encoded', () => {
    const path = signInPath({ returnTo: '/libraries/3?x=1#y' })
    expect(path).toBe(`${AUTH_ROUTES.signIn}?${AUTH_QUERY.returnTo}=%2Flibraries%2F3%3Fx%3D1%23y`)
    expect(new URL(path, window.location.origin).searchParams.get(AUTH_QUERY.returnTo)).toBe(
      '/libraries/3?x=1#y',
    )
  })
})

describe('checkEmailPath', () => {
  it('carries the address encoded', () => {
    expect(checkEmailPath({ email: 'jordan+raven@example.com' })).toBe(
      `${AUTH_ROUTES.checkEmail}?${AUTH_QUERY.email}=jordan%2Braven%40example.com`,
    )
  })
})

describe('confirmUrl', () => {
  it('puts the confirm route on the web address, whatever trailing slash it has', () => {
    expect(confirmUrl({ webUrl: 'https://raven.example.test' })).toBe(
      'https://raven.example.test/auth/confirm',
    )
    expect(confirmUrl({ webUrl: 'https://raven.example.test/' })).toBe(
      'https://raven.example.test/auth/confirm',
    )
  })
})
