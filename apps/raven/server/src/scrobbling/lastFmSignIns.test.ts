import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LASTFM_SIGN_IN_MS, LastFmSignIns } from '@/scrobbling/lastFmSignIns'
import { ScrobbleCipher } from '@/scrobbling/scrobbleCipher'
import { SettingsRepository } from '@/settings/settingsRepository'
import { manualClock } from '@/test/clock'
import { testDatabase } from '@/test/database'
import { TEST_ACCOUNTS } from '@/test/repositories'

const SIGN_IN = { account: TEST_ACCOUNTS.b, returnTo: 'wren://scrobbling' }

describe('LastFmSignIns', () => {
  const database = testDatabase('raven-lastfm-sign-ins-')

  beforeAll(() => database.open())
  afterAll(() => database.close())

  const signIns = () => {
    const { clock, advance } = manualClock()
    advance(Date.parse('2026-10-31T12:00:00Z'))
    const cipher = new ScrobbleCipher(new SettingsRepository(database.get()))
    return { signIns: new LastFmSignIns(cipher, clock), advance }
  }

  it('takes a state once, and refuses it again', () => {
    const { signIns: store } = signIns()
    const state = store.start(SIGN_IN)
    expect(store.finish(state)).toEqual(SIGN_IN)
    expect(store.finish(state)).toBeNull()
  })

  it('refuses a state that has expired, was changed or came from another server run', () => {
    const { signIns: store, advance } = signIns()
    const late = store.start(SIGN_IN)
    advance(LASTFM_SIGN_IN_MS)
    expect(store.finish(late)).toBeNull()

    const state = store.start(SIGN_IN)
    const [text, signature] = state.split('.')
    const forged = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(text ?? '', 'base64url').toString()),
        account: TEST_ACCOUNTS.a,
      }),
    ).toString('base64url')
    expect(store.finish(`${forged}.${signature ?? ''}`)).toBeNull()
    expect(signIns().signIns.finish(state)).toBeNull()
    expect(store.finish(state)).toEqual(SIGN_IN)
  })

  it("keeps one sign-in per account, so starting again never pushes out another account's", () => {
    const { signIns: store } = signIns()
    const others = store.start({ ...SIGN_IN, account: TEST_ACCOUNTS.a })
    const first = store.start(SIGN_IN)
    Array.from({ length: 300 }).forEach(() => store.start(SIGN_IN))
    const last = store.start(SIGN_IN)
    expect(store.finish(first)).toBeNull()
    expect(store.finish(last)).toEqual(SIGN_IN)
    expect(store.finish(others)).toEqual({ ...SIGN_IN, account: TEST_ACCOUNTS.a })
  })
})
