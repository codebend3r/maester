import { describe, expect, it } from 'bun:test'
import { AUTH_CONFIG_STATES, ApiError, type AuthConfig } from '@raven/core'

import {
  ACCOUNT_ANSWERS,
  AUTH_READS,
  answerOf,
  hasAccounts,
  isLetIn,
  readAuthConfig,
} from '@/servers/authConfigs'
import { MOVED_PIN, PIN, readyConfigOf } from '@/test/accountPins'

/** A server's client that answers `GET /api/auth/config` with `answer`, or fails with it. */
const answering = (answer: AuthConfig | Error) => ({
  getAuthConfig: async (): Promise<AuthConfig> => {
    if (answer instanceof Error) throw answer
    return answer
  },
})

const read = ({
  answer,
  account = null,
}: {
  answer: AuthConfig | Error
  account?: typeof PIN | typeof MOVED_PIN | null
}) => readAuthConfig({ api: answering(answer), server: { account } })

describe('readAuthConfig', () => {
  it('pins the three endpoints of a ready server seen for the first time', async () => {
    expect(await read({ answer: readyConfigOf(PIN) })).toEqual({
      kind: AUTH_READS.pinned,
      account: PIN,
    })
  })

  it('pins them as origins, whatever slash or case the server wrote them with', async () => {
    const answer = readyConfigOf({
      ...PIN,
      supabaseUrl: 'HTTPS://Project.Supabase.co/',
      webUrl: `${PIN.webUrl}/`,
    })
    expect(await read({ answer })).toEqual({ kind: AUTH_READS.pinned, account: PIN })
  })

  it('keeps the pin a server names again', async () => {
    expect(await read({ answer: readyConfigOf(PIN), account: PIN })).toEqual({
      kind: AUTH_READS.pinned,
      account: PIN,
    })
  })

  it('asks before following a server whose sign-in names other endpoints', async () => {
    expect(await read({ answer: readyConfigOf(MOVED_PIN), account: PIN })).toEqual({
      kind: AUTH_READS.moved,
      account: MOVED_PIN,
      host: 'moved.supabase.co',
      pinnedHost: 'project.supabase.co',
    })
  })

  it('asks when only the publishable key changed, since the project behind it may have', async () => {
    const answer = readyConfigOf({ ...PIN, publishableKey: 'sb_publishable_other' })
    expect((await read({ answer, account: PIN })).kind).toBe(AUTH_READS.moved)
  })

  it.each([
    ['plain http off the loopback', { supabaseUrl: 'http://project.supabase.co' }],
    ['a path', { webUrl: 'https://raven.example.test/sign-in' }],
    ['a secret key', { publishableKey: 'sb_secret_never_publish_this' }],
  ])('refuses endpoints the app cannot use: %s, pinned or not', async (_name, change) => {
    const answer = readyConfigOf({ ...PIN, ...change })
    expect(await read({ answer })).toEqual({ kind: AUTH_READS.unusable })
    expect(await read({ answer, account: PIN })).toEqual({ kind: AUTH_READS.unusable })
  })

  it.each([
    [AUTH_CONFIG_STATES.off, ACCOUNT_ANSWERS.off],
    [AUTH_CONFIG_STATES.unavailable, ACCOUNT_ANSWERS.unavailable],
  ] as const)('goes on to the PIN when accounts are %s', async (state, answer) => {
    expect(await read({ answer: { state } })).toEqual({ kind: AUTH_READS.accountless, answer })
  })

  it('goes on to the PIN when the server is older than accounts and has no such route', async () => {
    const answer = new ApiError({ status: 404, message: 'Not Found' })
    expect(await read({ answer, account: PIN })).toEqual({
      kind: AUTH_READS.accountless,
      answer: ACCOUNT_ANSWERS.legacy,
    })
  })

  it('fails as the call failed when the server cannot say', async () => {
    const outage = new ApiError({ status: 502, message: 'Bad Gateway' })
    await expect(read({ answer: outage })).rejects.toBe(outage)
    const offline = new TypeError('Network request failed')
    await expect(read({ answer: offline })).rejects.toBe(offline)
  })
})

describe('answerOf', () => {
  it('is ready for every answer a ready server gave, whatever became of its pin', () => {
    expect(answerOf({ kind: AUTH_READS.pinned, account: PIN })).toBe(ACCOUNT_ANSWERS.ready)
    expect(answerOf({ kind: AUTH_READS.unusable })).toBe(ACCOUNT_ANSWERS.ready)
    expect(
      answerOf({ kind: AUTH_READS.moved, account: MOVED_PIN, host: 'a', pinnedHost: 'b' }),
    ).toBe(ACCOUNT_ANSWERS.ready)
  })

  it('is what a server without accounts said', () => {
    expect(answerOf({ kind: AUTH_READS.accountless, answer: ACCOUNT_ANSWERS.legacy })).toBe(
      ACCOUNT_ANSWERS.legacy,
    )
  })
})

describe('hasAccounts', () => {
  it('has accounts when the server last said ready, pinned or not', () => {
    expect(hasAccounts({ account: null, answer: ACCOUNT_ANSWERS.ready })).toBe(true)
  })

  it('has none when the server last said off or had no auth route, though a pin is kept', () => {
    expect(hasAccounts({ account: PIN, answer: ACCOUNT_ANSWERS.off })).toBe(false)
    expect(hasAccounts({ account: PIN, answer: ACCOUNT_ANSWERS.legacy })).toBe(false)
  })

  it('goes by the pin when the server has not said this run, or said its accounts are down', () => {
    expect(hasAccounts({ account: PIN, answer: null })).toBe(true)
    expect(hasAccounts({ account: null, answer: null })).toBe(false)
    expect(hasAccounts({ account: PIN, answer: ACCOUNT_ANSWERS.unavailable })).toBe(true)
    expect(hasAccounts({ account: null, answer: ACCOUNT_ANSWERS.unavailable })).toBe(false)
  })
})

describe('isLetIn', () => {
  it('lets the viewer in to a server with accounts only while its account is signed in', () => {
    expect(isLetIn({ account: PIN, answer: ACCOUNT_ANSWERS.ready, isSignedIn: true })).toBe(true)
    expect(isLetIn({ account: PIN, answer: ACCOUNT_ANSWERS.ready, isSignedIn: false })).toBe(false)
    expect(isLetIn({ account: PIN, answer: null, isSignedIn: false })).toBe(false)
  })

  it('always lets the viewer in to a server without them', () => {
    expect(isLetIn({ account: null, answer: null, isSignedIn: false })).toBe(true)
    expect(isLetIn({ account: PIN, answer: ACCOUNT_ANSWERS.off, isSignedIn: false })).toBe(true)
  })
})
