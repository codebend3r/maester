import { describe, expect, it } from 'bun:test'
import { bearerToken } from '@/auth'

describe('bearerToken', () => {
  it('reads the token after the scheme, in any case', () => {
    expect(bearerToken({ header: 'Bearer abc' })).toBe('abc')
    expect(bearerToken({ header: 'bearer abc' })).toBe('abc')
  })

  it('is null for another scheme, no token, extra parts or no header', () => {
    expect(bearerToken({ header: 'Basic abc' })).toBeNull()
    expect(bearerToken({ header: 'Bearer ' })).toBeNull()
    expect(bearerToken({ header: 'Bearer' })).toBeNull()
    expect(bearerToken({ header: 'Bearer a b' })).toBeNull()
    expect(bearerToken({ header: undefined })).toBeNull()
  })
})
