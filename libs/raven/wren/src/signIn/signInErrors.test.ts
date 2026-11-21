import { describe, expect, it } from 'bun:test'
import { SIGN_IN_ERRORS } from '@raven/core'

import { SIGN_IN_COPY } from '@/copy/screens'
import { signInErrorsOf } from '@/signIn/signInErrors'

const MISSING = { kind: SIGN_IN_ERRORS.missing } as const

describe('signInErrorsOf', () => {
  it('says nothing before a submit has failed', () => {
    expect(signInErrorsOf({ error: null, email: '', password: '' })).toEqual({
      banner: null,
      email: null,
      password: null,
    })
  })

  it('marks each empty field under the banner when one was left empty', () => {
    expect(signInErrorsOf({ error: MISSING, email: '  ', password: '' })).toEqual({
      banner: SIGN_IN_COPY.badAccount,
      email: SIGN_IN_COPY.enterEmail,
      password: SIGN_IN_COPY.enterPassword,
    })
  })

  it("drops a field's line once something is typed in it", () => {
    const errors = signInErrorsOf({
      error: MISSING,
      email: 'listener@example.com',
      password: '',
    })
    expect(errors.email).toBeNull()
    expect(errors.password).toBe(SIGN_IN_COPY.enterPassword)
  })

  it("says a wrong email or password in Wren's words, in the banner alone", () => {
    expect(
      signInErrorsOf({
        error: { kind: SIGN_IN_ERRORS.badCredentials },
        email: 'listener@example.com',
        password: 'hunter2',
      }),
    ).toEqual({ banner: SIGN_IN_COPY.wrongAccount, email: null, password: null })
  })

  it('says raven is out of reach in the banner alone', () => {
    expect(
      signInErrorsOf({
        error: { kind: SIGN_IN_ERRORS.unreachable },
        email: 'a@b.c',
        password: 'x',
      }),
    ).toEqual({ banner: SIGN_IN_COPY.unreachable, email: null, password: null })
  })

  it.each([
    { kind: SIGN_IN_ERRORS.full, banner: SIGN_IN_COPY.full },
    { kind: SIGN_IN_ERRORS.notAdded, banner: SIGN_IN_COPY.notAdded },
  ])("says the phone's $kind in the banner alone", ({ kind, banner }) => {
    expect(signInErrorsOf({ error: { kind }, email: 'a@b.c', password: 'x' })).toEqual({
      banner,
      email: null,
      password: null,
    })
  })

  it("keeps any other refusal in the service's own words", () => {
    const banner = 'Email not confirmed'
    expect(
      signInErrorsOf({
        error: { kind: SIGN_IN_ERRORS.refused, message: banner },
        email: 'a@b.c',
        password: 'x',
      }).banner,
    ).toBe(banner)
  })
})
