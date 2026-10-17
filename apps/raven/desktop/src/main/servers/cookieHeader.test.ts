import { describe, expect, it } from 'bun:test'
import { SERVER_COOKIES, cookieHeader } from '@/main/servers/cookieHeader'

const UNLOCK = { name: 'raven_unlock', value: 'a.b' }
const ADMIN = { name: 'raven_admin', value: 'c.d' }

describe('cookieHeader', () => {
  it('names the two server cookies', () => {
    expect(SERVER_COOKIES).toEqual(['raven_unlock', 'raven_admin'])
  })

  it('joins both cookies in SERVER_COOKIES order, whatever order they come in', () => {
    expect(cookieHeader([UNLOCK, ADMIN])).toBe('Cookie: raven_unlock=a.b; raven_admin=c.d')
    expect(cookieHeader([ADMIN, UNLOCK])).toBe('Cookie: raven_unlock=a.b; raven_admin=c.d')
  })

  it('sends only raven_admin when it is the only one', () => {
    expect(cookieHeader([ADMIN])).toBe('Cookie: raven_admin=c.d')
  })

  it('drops an unrelated cookie', () => {
    expect(cookieHeader([{ name: 'session', value: 'x' }, ADMIN])).toBe('Cookie: raven_admin=c.d')
    expect(cookieHeader([{ name: 'session', value: 'x' }])).toBeNull()
  })

  it('matches names exactly', () => {
    expect(
      cookieHeader([
        { name: 'RAVEN_UNLOCK', value: 'x' },
        { name: 'raven_unlock ', value: 'x' },
        { name: 'raven_unlock2', value: 'x' },
      ]),
    ).toBeNull()
  })

  it('drops a value that would split or extend the header', () => {
    expect(cookieHeader([{ name: 'raven_unlock', value: 'a, b' }])).toBeNull()
    expect(cookieHeader([{ name: 'raven_unlock', value: 'a\r\nX: y' }, ADMIN])).toBe(
      'Cookie: raven_admin=c.d',
    )
    expect(cookieHeader([{ name: 'raven_unlock', value: 'a; raven_admin=forged' }])).toBeNull()
    expect(cookieHeader([{ name: 'raven_unlock', value: 'a b' }])).toBeNull()
    expect(cookieHeader([{ name: 'raven_unlock', value: 'a\nb' }])).toBeNull()
    expect(cookieHeader([{ name: 'raven_unlock', value: 'a\u0000' }])).toBeNull()
    expect(cookieHeader([{ name: 'raven_unlock', value: '"a"' }])).toBeNull()
    expect(cookieHeader([{ name: 'raven_unlock', value: 'a=b' }])).toBeNull()
  })

  it('drops an empty value', () => {
    expect(cookieHeader([{ name: 'raven_unlock', value: '' }])).toBeNull()
  })

  it('keeps the signed values the server sets', () => {
    expect(
      cookieHeader([
        { name: 'raven_unlock', value: '1760000000000.Ab-_9z' },
        { name: 'raven_admin', value: '1.2.x~y' },
      ]),
    ).toBe('Cookie: raven_unlock=1760000000000.Ab-_9z; raven_admin=1.2.x~y')
  })

  it('keeps the first of a repeated name', () => {
    expect(cookieHeader([UNLOCK, { name: 'raven_unlock', value: 'later' }])).toBe(
      'Cookie: raven_unlock=a.b',
    )
  })

  it('keeps the first valid one when an earlier repeat is malformed', () => {
    expect(cookieHeader([{ name: 'raven_unlock', value: 'a;b' }, UNLOCK])).toBe(
      'Cookie: raven_unlock=a.b',
    )
  })

  it('is null for no cookies', () => {
    expect(cookieHeader([])).toBeNull()
  })
})
