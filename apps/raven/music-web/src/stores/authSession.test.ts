import { describe, expect, it } from 'bun:test'
import { queryKeys, useAudioQueue } from '@raven/ui/headless'
import { waitFor } from '@testing-library/react'
import { queryClient } from '@/lib/queryClient'
import { AUTH_SESSION_STATUSES, useAuthSession } from '@/stores/authSession'
import {
  SESSION_COOKIES,
  fakeAuthClient,
  fakeSession,
  readyConfig as config,
} from '@/test/authClient'
import { AIRBAG } from '@/test/music'

const AUTH_CHANGES = {
  signedIn: 'SIGNED_IN',
  signedOut: 'SIGNED_OUT',
  renewed: 'TOKEN_REFRESHED',
} as const

type StartOptions = Parameters<ReturnType<typeof useAuthSession.getState>['start']>[0]

// `start` settles with the client or null and never rejects; these tests read the store instead.
const start = (options: StartOptions) => {
  useAuthSession
    .getState()
    .start(options)
    .catch(() => undefined)
}

const signedInAs = async (session = fakeSession({ userId: 'u1', accessToken: 't1' })) => {
  const fake = fakeAuthClient({ session })
  start({ config, createClient: async () => fake.client, cookies: SESSION_COOKIES })
  await waitFor(() =>
    expect(useAuthSession.getState().session?.userId ?? null).toBe(session.user.id),
  )
  return fake
}

describe('useAuthSession', () => {
  it('settles signed out at once in a browser with no session cookie, before Supabase loads', () => {
    start({
      config,
      createClient: () => new Promise(() => undefined),
      cookies: 'theme=dusk',
    })

    expect(useAuthSession.getState().status).toBe(AUTH_SESSION_STATUSES.ready)
    expect(useAuthSession.getState().session).toBeNull()
  })

  it.each([
    { name: 'a session cookie', cookies: SESSION_COOKIES },
    { name: 'a chunked session cookie', cookies: `${config.cookieName}.0=x` },
  ])('waits for Supabase to read $name', ({ cookies }) => {
    start({ config, createClient: () => new Promise(() => undefined), cookies })

    expect(useAuthSession.getState().status).toBe(AUTH_SESSION_STATUSES.booting)
  })

  it('settles signed out when Supabase fails to load, and hands sign-in no client', async () => {
    start({
      config,
      createClient: () => Promise.reject(new Error('chunk failed')),
      cookies: SESSION_COOKIES,
    })

    expect(await useAuthSession.getState().clientLoad).toBeNull()
    expect(useAuthSession.getState().status).toBe(AUTH_SESSION_STATUSES.ready)
    expect(useAuthSession.getState().session).toBeNull()
  })

  it('reads the session the cookie holds and carries its token, never the refresh token', async () => {
    await signedInAs()

    expect(useAuthSession.getState().status).toBe(AUTH_SESSION_STATUSES.ready)
    expect(useAuthSession.getState().session).toEqual({ accessToken: 't1', userId: 'u1' })
  })

  it('builds its client once, however often it is started', async () => {
    const built: string[] = []
    const { client } = fakeAuthClient()
    const createClient = async () => {
      built.push('client')
      return client
    }
    start({ config, createClient, cookies: '' })
    start({ config, createClient, cookies: '' })
    await useAuthSession.getState().clientLoad

    expect(built).toEqual(['client'])
  })

  it('keeps the answers and the queue through a renewed token', async () => {
    const fake = await signedInAs()
    queryClient.setQueryData(queryKeys.libraries, [])
    useAudioQueue.getState().playTracks({ tracks: [AIRBAG], startAt: 0, source: null })

    fake.emit({
      event: AUTH_CHANGES.renewed,
      session: fakeSession({ userId: 'u1', accessToken: 't2' }),
    })

    expect(useAuthSession.getState().session?.accessToken ?? null).toBe('t2')
    expect(queryClient.getQueryData(queryKeys.libraries)).toEqual([])
    expect(useAudioQueue.getState().queue.order).toHaveLength(1)
  })

  it.each([
    {
      name: 'another account signs in',
      event: AUTH_CHANGES.signedIn,
      next: fakeSession({ userId: 'u2' }),
    },
    { name: 'the account signs out', event: AUTH_CHANGES.signedOut, next: null },
  ])(
    "empties the last account's answers and stops its music when $name",
    async ({ event, next }) => {
      const fake = await signedInAs()
      queryClient.setQueryData(queryKeys.libraries, [])
      useAudioQueue.getState().playTracks({ tracks: [AIRBAG], startAt: 0, source: null })

      fake.emit({ event, session: next })

      expect(useAuthSession.getState().session?.userId ?? null).toBe(next?.user.id ?? null)
      await waitFor(() => expect(queryClient.getQueryData(queryKeys.libraries)).toBeUndefined())
      expect(useAudioQueue.getState().queue.order).toHaveLength(0)
    },
  )
})
