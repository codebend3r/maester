import { describe, expect, it } from 'bun:test'

import { SIGN_IN_ERRORS, type SignInErrorCopy, signInErrorTextOf } from '@/account/signInErrors'

const COPY = {
  [SIGN_IN_ERRORS.missing]: 'Fill in both fields.',
  [SIGN_IN_ERRORS.badCredentials]: 'Wrong email or password.',
  [SIGN_IN_ERRORS.unreachable]: 'Out of reach.',
  [SIGN_IN_ERRORS.full]: 'No room.',
  [SIGN_IN_ERRORS.notAdded]: 'Not added.',
} as const satisfies SignInErrorCopy

describe('signInErrorTextOf', () => {
  it("says each named error in the app's words", () => {
    expect(signInErrorTextOf({ error: { kind: SIGN_IN_ERRORS.missing }, copy: COPY })).toBe(
      COPY.missing,
    )
    expect(signInErrorTextOf({ error: { kind: SIGN_IN_ERRORS.badCredentials }, copy: COPY })).toBe(
      COPY.badCredentials,
    )
    expect(signInErrorTextOf({ error: { kind: SIGN_IN_ERRORS.unreachable }, copy: COPY })).toBe(
      COPY.unreachable,
    )
  })

  it("says a refusal in the service's own words", () => {
    expect(
      signInErrorTextOf({
        error: { kind: SIGN_IN_ERRORS.refused, message: 'Email not confirmed' },
        copy: COPY,
      }),
    ).toBe('Email not confirmed')
  })
})
