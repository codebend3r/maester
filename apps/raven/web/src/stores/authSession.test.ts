import { describe, expect, it } from 'bun:test'
import { AUTH_CONFIG_STATES, AUTH_COOKIE } from '@raven/core'
import type { ReadyAuthConfig } from '@/lib/authClient'
import { AUTH_SESSION_STATUSES, useAuthSession } from '@/stores/authSession'
import { fakeAuthClient, fakeSession } from '@/test/authClient'

const config: ReadyAuthConfig = {
  state: AUTH_CONFIG_STATES.ready,
  supabaseUrl: 'http://127.0.0.1:54321',
  publishableKey: 'sb_publishable_test',
  webUrl: 'http://localhost:8484',
  cookieName: AUTH_COOKIE,
}

const settled = () => Promise.resolve().then(() => undefined)

describe('useAuthSession', () => {
  it('boots with the stored session and carries its token', async () => {
    const { client } = fakeAuthClient({ session: fakeSession({ userId: 'u1', accessToken: 't1' }) })
    expect(useAuthSession.getState().status).toBe(AUTH_SESSION_STATUSES.booting)

    useAuthSession.getState().start({ config, createClient: () => client })
    await settled()

    expect(useAuthSession.getState().status).toBe(AUTH_SESSION_STATUSES.ready)
    expect(useAuthSession.getState().session).toEqual({ accessToken: 't1', userId: 'u1' })
    expect(useAuthSession.getState().accessToken()).toBe('t1')
  })

  it('boots signed out without a stored session', async () => {
    const { client } = fakeAuthClient()

    useAuthSession.getState().start({ config, createClient: () => client })
    await settled()

    expect(useAuthSession.getState().status).toBe(AUTH_SESSION_STATUSES.ready)
    expect(useAuthSession.getState().session).toBeNull()
    expect(useAuthSession.getState().accessToken()).toBeNull()
  })

  it('follows the session through sign in, refresh and sign out', async () => {
    const fake = fakeAuthClient()
    useAuthSession.getState().start({ config, createClient: () => fake.client })
    await settled()

    fake.emit({ event: 'SIGNED_IN', session: fakeSession({ userId: 'u2', accessToken: 'a' }) })
    expect(useAuthSession.getState().session).toEqual({ accessToken: 'a', userId: 'u2' })

    fake.emit({
      event: 'TOKEN_REFRESHED',
      session: fakeSession({ userId: 'u2', accessToken: 'b' }),
    })
    expect(useAuthSession.getState().accessToken()).toBe('b')

    fake.emit({ event: 'SIGNED_OUT', session: null })
    expect(useAuthSession.getState().session).toBeNull()
    expect(useAuthSession.getState().accessToken()).toBeNull()
  })

  it('starts once, however often it is asked', async () => {
    const fake = fakeAuthClient()
    const start = () => useAuthSession.getState().start({ config, createClient: () => fake.client })

    start()
    start()
    await settled()

    expect(fake.listenerCount()).toBe(1)
  })

  it('settles signed out when the stored session cannot be read', async () => {
    const fake = fakeAuthClient()
    const failing = {
      ...fake.client,
      getSession: () => Promise.reject(new Error('storage refused')),
    }

    useAuthSession.getState().start({ config, createClient: () => failing })
    await settled()

    expect(useAuthSession.getState().status).toBe(AUTH_SESSION_STATUSES.ready)
    expect(useAuthSession.getState().session).toBeNull()
  })
})
