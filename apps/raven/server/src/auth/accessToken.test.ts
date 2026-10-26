import { AUTH_COOKIE, AUTH_METHODS, AUTH_SCHEME } from '@raven/core'
import { describe, expect, it } from 'vitest'
import { AUTH_ENCODINGS, accessTokenOf } from '@/auth/accessToken'

const TOKEN = 'test-access-token'
const session = `base64-${Buffer.from(JSON.stringify({ access_token: TOKEN, refresh_token: 'never-returned' })).toString(AUTH_ENCODINGS.base64url)}`
const cookie = `${AUTH_COOKIE}=${session}`

type ReadProps = { authorization?: string; header?: string; method?: string }

const read = ({ authorization, header = cookie, method = AUTH_METHODS.get }: ReadProps = {}) =>
  accessTokenOf({ method, authorization, cookie: header })

describe('raven access token boundary', () => {
  it('prefers Bearer over the cookie', () => {
    expect(read({ authorization: `${AUTH_SCHEME} other-token` })).toBe('other-token')
    expect(read({ authorization: `${AUTH_SCHEME.toLowerCase()} ${TOKEN}` })).toBe(TOKEN)
  })

  it.each(['', 'Basic abc', 'Bearer', 'Bearer ', 'Bearer token extra'])(
    'does not fall back from a bad Authorization header: %s',
    (authorization) => {
      expect(read({ authorization })).toBeNull()
    },
  )

  it('decodes host-only base64url sessions on GET and HEAD only', () => {
    expect(read()).toBe(TOKEN)
    expect(read({ method: AUTH_METHODS.head })).toBe(TOKEN)
    expect(read({ method: AUTH_METHODS.post })).toBeNull()
    expect(read({ method: AUTH_METHODS.post, authorization: `${AUTH_SCHEME} ${TOKEN}` })).toBe(
      TOKEN,
    )
  })

  it('reassembles out-of-order chunks and ignores unrelated cookies', () => {
    const split = 37
    expect(
      read({
        header: `other=abc; ${AUTH_COOKIE}.1=${session.slice(split)}; ${AUTH_COOKIE}.0=${session.slice(0, split)}`,
      }),
    ).toBe(TOKEN)
  })

  it.each([
    '',
    `${AUTH_COOKIE}=broken`,
    `${AUTH_COOKIE}=%E0%A4%A`,
    `${AUTH_COOKIE}=${session}; ${AUTH_COOKIE}=${session}`,
    `${AUTH_COOKIE}=${session}; ${AUTH_COOKIE}.0=${session}`,
    `${AUTH_COOKIE}.1=${session}`,
    `${AUTH_COOKIE}.0=${session}; ${AUTH_COOKIE}.0=${session}`,
    `${AUTH_COOKIE}.0=${session}; ${AUTH_COOKIE}.2=tail`,
    `${AUTH_COOKIE}.00=${session}`,
    `${AUTH_COOKIE}=null`,
    `${AUTH_COOKIE}=${encodeURIComponent(JSON.stringify({ access_token: 123 }))}`,
    `${AUTH_COOKIE}=${'a'.repeat(32_769)}`,
  ])('rejects malformed or ambiguous cookies', (header) => {
    expect(read({ header })).toBeNull()
  })

  it('handles an absent cookie and legacy plain JSON sessions', () => {
    expect(
      accessTokenOf({ method: AUTH_METHODS.get, authorization: undefined, cookie: undefined }),
    ).toBeNull()
    expect(
      read({
        header: `${AUTH_COOKIE}=${encodeURIComponent(JSON.stringify({ access_token: TOKEN }))}`,
      }),
    ).toBe(TOKEN)
  })
})
