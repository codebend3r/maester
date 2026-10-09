import { describe, expect, it } from 'vitest'
import { safeReturnTo } from '@/auth/returnTo.js'

const appOrigins = ['https://luwin.maester.example.com']
const check = (value: unknown) => safeReturnTo({ value, appOrigins, fallback: '/' })

describe('safeReturnTo', () => {
  it('keeps a path on rookery', () => {
    expect(check('/account?tab=1')).toBe('/account?tab=1')
  })

  it('keeps a URL on an allowed app', () => {
    expect(check('https://luwin.maester.example.com/chat')).toBe(
      'https://luwin.maester.example.com/chat',
    )
  })

  it.each([
    ['a foreign origin', 'https://evil.example/'],
    ['the same host over http', 'http://luwin.maester.example.com/'],
    ['a protocol-relative URL', '//evil.example/'],
    ['a backslash trick', '/\\evil.example/'],
    ['a tab trick', '/\t/evil.example/'],
    ['a script URL', 'javascript:alert(1)'],
    ['nothing', ''],
    ['not a string', 42],
  ])('turns %s into the fallback', (_label, value) => {
    expect(check(value)).toBe('/')
  })
})
