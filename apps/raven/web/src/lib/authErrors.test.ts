import { describe, expect, it } from 'bun:test'
import { AuthApiError, AuthWeakPasswordError } from '@supabase/supabase-js'
import { AUTH_ERRORS, PASSWORD_COPY, weakPasswordMessage } from '@/lib/authErrors'

describe('weakPasswordMessage', () => {
  it('states the rules plainly for a password too short or missing a kind of character', () => {
    const tooWeak = new AuthWeakPasswordError(
      'Password should contain at least one character of each: abc',
      422,
      ['length', 'characters'],
    )
    expect(weakPasswordMessage(tooWeak)).toBe(PASSWORD_COPY.rules)
  })

  it('says a password only refused for a breach appeared in one', () => {
    const leaked = new AuthWeakPasswordError('Password is known to be weak', 422, ['pwned'])
    expect(weakPasswordMessage(leaked)).toBe(PASSWORD_COPY.breached)
  })

  it('states the rules when the refusal names no reasons', () => {
    expect(weakPasswordMessage(new AuthApiError('weak', 422, AUTH_ERRORS.weakPassword))).toBe(
      PASSWORD_COPY.rules,
    )
  })

  it('leaves every other refusal alone', () => {
    expect(
      weakPasswordMessage(new AuthApiError('nope', 400, AUTH_ERRORS.invalidCredentials)),
    ).toBeNull()
    expect(weakPasswordMessage(new Error('offline'))).toBeNull()
  })
})
