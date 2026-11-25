import { describe, expect, it, mock } from 'bun:test'
import { REFRESH_OUTCOMES } from '@raven/core'
import { queryKeys, useAudioQueue } from '@raven/ui/headless'
import { AuthApiError, type AuthError, AuthRetryableFetchError } from '@supabase/supabase-js'
import type { AuthClient } from '@/lib/authClient'
import { queryClient } from '@/lib/queryClient'
import { refreshSession, signOut } from '@/lib/session'
import { useAuthSession } from '@/stores/authSession'
import { fakeAuthClient, fakeSession } from '@/test/authClient'
import { AIRBAG } from '@/test/music'

type RefreshResult = Awaited<ReturnType<AuthClient['refreshSession']>>

const holding = (calls: Partial<AuthClient>): void =>
  useAuthSession.setState({ client: fakeAuthClient({ calls }).client })

const refusedRefresh = (error: AuthError): RefreshResult => ({
  data: { user: null, session: null },
  error,
})

describe('refreshSession', () => {
  it('hands back the new token once Supabase renews the session', async () => {
    const session = fakeSession({ accessToken: 'renewed' })
    holding({
      refreshSession: async () => ({ data: { user: session.user, session }, error: null }),
    })

    expect(await refreshSession()).toEqual({
      kind: REFRESH_OUTCOMES.refreshed,
      accessToken: 'renewed',
    })
  })

  it('says the session was rejected when Supabase refuses the refresh token', async () => {
    holding({
      refreshSession: async () =>
        refusedRefresh(new AuthApiError('Invalid Refresh Token', 400, 'refresh_token_not_found')),
    })

    expect(await refreshSession()).toEqual({ kind: REFRESH_OUTCOMES.rejected })
  })

  it('leaves the session alone when Supabase cannot be reached, or no client is built', async () => {
    expect(await refreshSession()).toEqual({ kind: REFRESH_OUTCOMES.unreachable })

    holding({
      refreshSession: async () => refusedRefresh(new AuthRetryableFetchError('Failed to fetch', 0)),
    })
    expect(await refreshSession()).toEqual({ kind: REFRESH_OUTCOMES.unreachable })
  })
})

describe('signOut', () => {
  it("ends the session and empties the account's answers and queue", async () => {
    const ended = mock(async () => ({ error: null }))
    holding({ signOut: ended })
    queryClient.setQueryData(queryKeys.libraries, [])
    useAudioQueue.getState().playTracks({ tracks: [AIRBAG] })

    await signOut({ queryClient })

    expect(ended).toHaveBeenCalledTimes(1)
    expect(queryClient.getQueryData(queryKeys.libraries)).toBeUndefined()
    expect(useAudioQueue.getState().queue.order).toHaveLength(0)
  })

  it('ends the local session when Supabase cannot be reached to end its own', async () => {
    const scopes: unknown[] = []
    holding({
      signOut: async (options) => {
        scopes.push(options?.scope ?? null)
        return { error: scopes.length === 1 ? new AuthRetryableFetchError('offline', 0) : null }
      },
    })

    await signOut({ queryClient })

    expect(scopes).toEqual([null, 'local'])
  })
})
