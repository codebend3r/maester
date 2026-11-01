import { describe, expect, it } from 'bun:test'
import { AUTH_EVENTS } from '@/lib/authClient'
import { createSelectionStore, queryKeys } from '@raven/ui/headless'
import { queryClient } from '@/lib/queryClient'
import { AUTH_SESSION_STATUSES, useAuthSession } from '@/stores/authSession'
import { useSelectionScopes } from '@/stores/selectionScope'
import { fakeAuthClient, fakeSession, readyConfig as config } from '@/test/authClient'

const settled = () => Promise.resolve().then(() => undefined)

describe('useAuthSession', () => {
  it('boots with the stored session and carries its token', async () => {
    const { client } = fakeAuthClient({ session: fakeSession({ userId: 'u1', accessToken: 't1' }) })
    expect(useAuthSession.getState().status).toBe(AUTH_SESSION_STATUSES.booting)

    useAuthSession.getState().start({ config, createClient: () => client })
    await settled()

    expect(useAuthSession.getState().status).toBe(AUTH_SESSION_STATUSES.ready)
    expect(useAuthSession.getState().session).toEqual({ accessToken: 't1', userId: 'u1' })
  })

  it('boots signed out without a stored session', async () => {
    const { client } = fakeAuthClient()

    useAuthSession.getState().start({ config, createClient: () => client })
    await settled()

    expect(useAuthSession.getState().status).toBe(AUTH_SESSION_STATUSES.ready)
    expect(useAuthSession.getState().session).toBeNull()
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
    expect(useAuthSession.getState().session?.accessToken).toBe('b')

    fake.emit({ event: 'SIGNED_OUT', session: null })
    expect(useAuthSession.getState().session).toBeNull()
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

describe('useAuthSession account changes', () => {
  const signedInAs = async (userId: string) => {
    const fake = fakeAuthClient({ session: fakeSession({ userId }) })
    useAuthSession.getState().start({ config, createClient: () => fake.client })
    await settled()
    queryClient.setQueryData(queryKeys.libraries, ['private to the first account'])
    const store = createSelectionStore()
    store.getState().start('card-1')
    useSelectionScopes.setState({
      scopes: [{ resolve: () => [], allKeys: () => [], store, selectButton: { current: null } }],
    })
    return { fake, store }
  }

  it('forgets the first account when another one signs in on the same browser', async () => {
    const { fake, store } = await signedInAs('u1')

    fake.emit({ event: 'SIGNED_IN', session: fakeSession({ userId: 'u2' }) })

    expect(queryClient.getQueryData(queryKeys.libraries)).toBeUndefined()
    expect(store.getState().selecting).toBe(false)
    expect(useAuthSession.getState().session?.userId).toBe('u2')
  })

  it('forgets the account when the session ends elsewhere', async () => {
    const { fake } = await signedInAs('u1')

    fake.emit({ event: 'SIGNED_OUT', session: null })

    expect(queryClient.getQueryData(queryKeys.libraries)).toBeUndefined()
  })

  it('keeps everything through a token refresh of the same account', async () => {
    const { fake, store } = await signedInAs('u1')

    fake.emit({
      event: 'TOKEN_REFRESHED',
      session: fakeSession({ userId: 'u1', accessToken: 'newer' }),
    })

    expect(queryClient.getQueryData<string[]>(queryKeys.libraries)).toEqual([
      'private to the first account',
    ])
    expect(store.getState().selecting).toBe(true)
  })

  it('asks again for what was read while nobody was signed in, and keeps the auth queries', async () => {
    const fake = fakeAuthClient()
    useAuthSession.getState().start({ config, createClient: () => fake.client })
    await settled()
    queryClient.setQueryData(queryKeys.libraries, ['read while signed out'])
    queryClient.setQueryData(queryKeys.authConfig, config)

    fake.emit({ event: 'SIGNED_IN', session: fakeSession({ userId: 'u1' }) })

    const stale = (key: readonly unknown[]) => queryClient.getQueryState(key)?.isInvalidated
    expect(stale(queryKeys.libraries)).toBe(true)
    expect(stale(queryKeys.authConfig)).toBe(false)
    const cached: unknown = queryClient.getQueryData(queryKeys.authConfig)
    expect(cached).toEqual(config)
  })
})

describe('useAuthSession recovery', () => {
  const started = async () => {
    const fake = fakeAuthClient()
    useAuthSession.getState().start({ config, createClient: () => fake.client })
    await settled()
    return fake
  }

  it('is not a recovery session by default, nor after an ordinary sign in', async () => {
    const fake = await started()
    expect(useAuthSession.getState().isRecovery).toBe(false)

    fake.emit({ event: 'SIGNED_IN', session: fakeSession() })

    expect(useAuthSession.getState().isRecovery).toBe(false)
  })

  it('is one from the recovery event until the session ends, through refreshes', async () => {
    const fake = await started()

    fake.emit({ event: AUTH_EVENTS.passwordRecovery, session: fakeSession() })
    expect(useAuthSession.getState().isRecovery).toBe(true)

    fake.emit({ event: 'TOKEN_REFRESHED', session: fakeSession({ accessToken: 'newer' }) })
    fake.emit({ event: 'SIGNED_IN', session: fakeSession() })
    expect(useAuthSession.getState().isRecovery).toBe(true)

    fake.emit({ event: 'SIGNED_OUT', session: null })
    expect(useAuthSession.getState().isRecovery).toBe(false)
  })

  it('ends when another account signs in, or when asked', async () => {
    const fake = await started()
    fake.emit({ event: AUTH_EVENTS.passwordRecovery, session: fakeSession({ userId: 'u1' }) })

    fake.emit({ event: 'SIGNED_IN', session: fakeSession({ userId: 'u2' }) })
    expect(useAuthSession.getState().isRecovery).toBe(false)

    fake.emit({ event: AUTH_EVENTS.passwordRecovery, session: fakeSession({ userId: 'u2' }) })
    useAuthSession.getState().endRecovery()
    expect(useAuthSession.getState().isRecovery).toBe(false)
  })
})
