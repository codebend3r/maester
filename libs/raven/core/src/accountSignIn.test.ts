import { describe, expect, it } from 'bun:test'
import {
  ACCOUNT_PAGES,
  AUTH_ERROR_CODES,
  SIGN_IN_MESSAGES,
  SIGN_IN_OUTCOMES,
  accountPageUrl,
  authRefusalIn,
  isAccountPage,
  refusalAt,
  signInMessageOf,
  signInOutcomeOf,
  signInUnavailable,
} from '@/accountSignIn'
import { AUTH_REFUSALS, AUTH_ROUTES } from '@/contract'

/** The en dash and the em dash, by their code points, so this file holds neither. */
const DASHES = new RegExp(`[${String.fromCodePoint(0x2013, 0x2014)}]`, 'u')
const UNLISTED_ERROR_CODE = 'unexpected_failure'
const WEB_URL = 'https://raven.example.test'
const SIGNED_OUT_BODY = JSON.stringify({ reason: AUTH_REFUSALS.signedOut, message: 'Sign in' })

describe('accountPageUrl', () => {
  it.each([
    [ACCOUNT_PAGES.signUp, AUTH_ROUTES.signUp],
    [ACCOUNT_PAGES.forgot, AUTH_ROUTES.forgot],
  ])('opens %s at its route on the web origin', (page, route) => {
    expect(accountPageUrl({ webUrl: WEB_URL, page })).toBe(`${WEB_URL}${route}`)
  })

  it('takes only the pages it names', () => {
    expect(isAccountPage(ACCOUNT_PAGES.signUp)).toBe(true)
    expect(isAccountPage(ACCOUNT_PAGES.forgot)).toBe(true)
    expect(isAccountPage('https://evil.example')).toBe(false)
    expect(isAccountPage(AUTH_ROUTES.signUp)).toBe(false)
  })
})

describe('signInOutcomeOf', () => {
  it.each([
    [{ code: AUTH_ERROR_CODES.invalidCredentials, status: 400 }, SIGN_IN_OUTCOMES.wrongPassword],
    [{ code: AUTH_ERROR_CODES.validationFailed, status: 400 }, SIGN_IN_OUTCOMES.wrongPassword],
    [{ code: AUTH_ERROR_CODES.emailNotConfirmed, status: 400 }, SIGN_IN_OUTCOMES.unconfirmed],
    [{ code: AUTH_ERROR_CODES.overRequestRateLimit, status: 429 }, SIGN_IN_OUTCOMES.rateLimited],
    [{ code: undefined, status: 429 }, SIGN_IN_OUTCOMES.rateLimited],
    [{ code: undefined, status: 500 }, SIGN_IN_OUTCOMES.unavailable],
    [{ code: UNLISTED_ERROR_CODE, status: 400 }, SIGN_IN_OUTCOMES.unavailable],
  ])('reads %o as %s', (error, kind) => {
    expect(signInOutcomeOf(error)).toBe(kind)
  })

  it('reads no Auth answer at all as unavailable', () => {
    expect(signInOutcomeOf(null)).toBe(SIGN_IN_OUTCOMES.unavailable)
  })
})

describe('signInMessageOf', () => {
  it('says what the sign-in forms are specified to say', () => {
    expect(SIGN_IN_MESSAGES.wrongPassword).toBe('Email or password is wrong.')
    expect(SIGN_IN_MESSAGES.unconfirmed).toBe(
      'Confirm your email first. The link is in your inbox.',
    )
    expect(SIGN_IN_MESSAGES.rateLimited).toBe('Wait a moment before trying again.')
    expect(SIGN_IN_MESSAGES.notOpen).toBe('That server is not taking sign ins right now.')
    expect(signInUnavailable({ name: 'Vhagar' })).toBe(
      'Vhagar could not sign you in right now. Try again.',
    )
  })

  it.each([
    [SIGN_IN_OUTCOMES.wrongPassword, SIGN_IN_MESSAGES.wrongPassword],
    [SIGN_IN_OUTCOMES.unconfirmed, SIGN_IN_MESSAGES.unconfirmed],
    [SIGN_IN_OUTCOMES.rateLimited, SIGN_IN_MESSAGES.rateLimited],
    [SIGN_IN_OUTCOMES.unavailable, signInUnavailable({ name: 'Vhagar' })],
  ])('says %s as %s', (kind, message) => {
    expect(signInMessageOf({ kind, name: 'Vhagar' })).toBe(message)
  })

  it('is plain copy with no dash', () => {
    Object.values(SIGN_IN_MESSAGES).forEach((message) => {
      expect(message).not.toMatch(DASHES)
    })
  })
})

describe('refusalAt', () => {
  it('reads the reason a refusal at one of the statuses gives', () => {
    expect(refusalAt({ status: 401, body: SIGNED_OUT_BODY, statuses: [401] })).toBe(
      AUTH_REFUSALS.signedOut,
    )
  })

  it('reads nothing at another status, or from a body that is no refusal', () => {
    expect(refusalAt({ status: 403, body: SIGNED_OUT_BODY, statuses: [401] })).toBeNull()
    expect(refusalAt({ status: 401, body: '{"message":"Wrong PIN"}', statuses: [401] })).toBeNull()
    expect(refusalAt({ status: 401, body: 'not json', statuses: [401] })).toBeNull()
    expect(authRefusalIn('')).toBeNull()
  })
})
