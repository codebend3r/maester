import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js'
import { ApiError, AUTH_REFUSALS } from '@raven/core'
import { api } from '@/lib/api'
import type { AuthClient } from '@/lib/authClient'
import { queryClient } from '@/lib/queryClient'
import { useAuthSession } from '@/stores/authSession'
import { fakeAccount, fakeAuthClient, fakeSession } from '@/test/authClient'

type Reply = { status: number; body: unknown }

const SIGNED_OUT: Reply = {
  status: 401,
  body: { reason: AUTH_REFUSALS.signedOut, message: 'Sign in to continue.' },
}

const seen: string[] = []

/** Answers each `/api/` call from `replies` in order, and notes the token it carried. */
const serverReplying = (replies: Reply[], onCall: (call: number) => void = () => undefined) =>
  spyOn(window, 'fetch').mockImplementation(
    Object.assign(
      async (_url: RequestInfo | URL, init?: RequestInit) => {
        const headers = new Headers(init?.headers)
        seen.push(headers.get('authorization') ?? '')
        onCall(seen.length)
        const reply = replies[seen.length - 1] ?? SIGNED_OUT
        return new Response(JSON.stringify(reply.body), {
          status: reply.status,
          headers: { 'content-type': 'application/json' },
        })
      },
      { preconnect: () => undefined },
    ),
  )

type SignedInWithProps = {
  refresh: AuthClient['refreshSession']
  signOut?: AuthClient['signOut']
}

const signedInWith = ({ refresh, signOut = async () => ({ error: null }) }: SignedInWithProps) => {
  const stale = fakeSession({ accessToken: 'stale' })
  const fake = fakeAuthClient({ session: stale, calls: { refreshSession: refresh, signOut } })
  useAuthSession.setState({
    client: fake.client,
    session: { accessToken: 'stale', userId: stale.user.id },
  })
}

const refreshedTo = (accessToken: string) => async () => {
  const session = fakeSession({ accessToken })
  useAuthSession.setState({ session: { accessToken, userId: session.user.id } })
  return { data: { session, user: session.user }, error: null }
}

afterEach(() => {
  seen.length = 0
  spyOn(window, 'fetch').mockRestore()
})

describe('api', () => {
  it('refreshes once on a signed_out refusal and repeats the call with the new token', async () => {
    const server = serverReplying([SIGNED_OUT, { status: 200, body: fakeAccount() }])
    signedInWith({ refresh: refreshedTo('fresh') })

    expect(await api.getMe()).toEqual(fakeAccount())

    expect(server).toHaveBeenCalledTimes(2)
    expect(seen).toEqual(['Bearer stale', 'Bearer fresh'])
  })

  it('signs out, without a third call, when the repeated call is refused too', async () => {
    const server = serverReplying([SIGNED_OUT, SIGNED_OUT])
    let signedOutCount = 0
    signedInWith({
      refresh: refreshedTo('fresh'),
      signOut: async () => {
        signedOutCount += 1
        return { error: null }
      },
    })
    queryClient.setQueryData(['libraries'], [])

    const error = await api.getMe().catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(ApiError)
    expect(error instanceof ApiError && error.refusal?.reason).toBe(AUTH_REFUSALS.signedOut)
    expect(server).toHaveBeenCalledTimes(2)
    expect(signedOutCount).toBe(1)
    expect(queryClient.getQueryData(['libraries'])).toBeUndefined()
  })

  it('signs out when the refresh token is refused', async () => {
    const server = serverReplying([SIGNED_OUT])
    let signedOutCount = 0
    signedInWith({
      refresh: async () => ({
        data: { session: null, user: null },
        error: new AuthApiError('Invalid Refresh Token', 400, 'refresh_token_not_found'),
      }),
      signOut: async () => {
        signedOutCount += 1
        return { error: null }
      },
    })

    await expect(api.getMe()).rejects.toBeInstanceOf(ApiError)

    expect(server).toHaveBeenCalledTimes(1)
    expect(signedOutCount).toBe(1)
  })

  it('stays signed in when the refresh cannot reach Supabase', async () => {
    serverReplying([SIGNED_OUT])
    let signedOutCount = 0
    signedInWith({
      refresh: async () => ({
        data: { session: null, user: null },
        error: new AuthRetryableFetchError('offline', 0),
      }),
      signOut: async () => {
        signedOutCount += 1
        return { error: null }
      },
    })

    await expect(api.getMe()).rejects.toBeInstanceOf(ApiError)

    expect(signedOutCount).toBe(0)
  })

  it('shares one refresh between calls refused together', async () => {
    const server = serverReplying([
      SIGNED_OUT,
      SIGNED_OUT,
      { status: 200, body: fakeAccount() },
      { status: 200, body: fakeAccount() },
    ])
    let refreshes = 0
    signedInWith({
      refresh: async () => {
        refreshes += 1
        return refreshedTo('fresh')()
      },
    })

    await Promise.all([api.getMe(), api.getMe()])

    expect(refreshes).toBe(1)
    expect(server).toHaveBeenCalledTimes(4)
    expect(seen.slice(2)).toEqual(['Bearer fresh', 'Bearer fresh'])
  })

  it('repeats a late refusal with the token already refreshed, without refreshing again', async () => {
    serverReplying([SIGNED_OUT, { status: 200, body: fakeAccount() }], (call) => {
      if (call === 1) {
        useAuthSession.setState({
          session: { accessToken: 'newer', userId: fakeSession().user.id },
        })
      }
    })
    let refreshes = 0
    signedInWith({
      refresh: async () => {
        refreshes += 1
        return refreshedTo('fresh')()
      },
    })

    await api.getMe()

    expect(refreshes).toBe(0)
    expect(seen).toEqual(['Bearer stale', 'Bearer newer'])
  })

  it('leaves other refusals alone', async () => {
    const server = serverReplying([
      { status: 403, body: { reason: AUTH_REFUSALS.pending, message: 'Waiting for approval.' } },
    ])
    signedInWith({ refresh: refreshedTo('fresh') })

    await expect(api.getMe()).rejects.toBeInstanceOf(ApiError)

    expect(server).toHaveBeenCalledTimes(1)
  })
})
