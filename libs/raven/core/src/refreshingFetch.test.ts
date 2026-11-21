import { describe, expect, it, mock } from 'bun:test'
import { HTTP_STATUSES } from '@shared/http'
import type { FetchInit, FetchResponse } from '@/apiClient'
import { AUTH_HEADERS, AUTH_REFUSALS, AUTH_SCHEME } from '@/contract'
import { REFRESH_OUTCOMES, type RefreshOutcome, refreshingFetch } from '@/refreshingFetch'
import { ROUTES } from '@/routes'
import { respond } from '@/test/apiClientFakes'

const bearer = (token: string): string => `${AUTH_SCHEME} ${token}`

type Answer = FetchResponse & { clone: () => FetchResponse }

/** An answer a caller may read once more from a copy, as a browser's `Response` is. */
const answer = (props: Parameters<typeof respond>[0]): Answer => ({
  ...respond(props),
  clone: () => respond(props),
})

const signedOutAnswer = (): Answer =>
  answer({
    status: HTTP_STATUSES.unauthorized,
    body: { reason: AUTH_REFUSALS.signedOut, message: 'Sign in again' },
  })

const fine = (): Answer => answer({ body: { ok: true } })

type ServerProps = {
  /** The tokens the server still takes. */
  good: readonly string[]
  refresh: () => Promise<RefreshOutcome>
}

/** A server that refuses every token but `good`, under a fetch that refreshes when refused. */
const serverTaking = ({ good, refresh }: ServerProps) => {
  const sent: (string | null)[] = []
  const signOut = mock(async () => undefined)
  const fetch = refreshingFetch({
    fetch: async (_url: string, init?: FetchInit) => {
      const authorization = init?.headers?.[AUTH_HEADERS.authorization] ?? null
      sent.push(authorization)
      return good.some((token) => authorization === bearer(token)) ? fine() : signedOutAnswer()
    },
    accessToken: () => 'old',
    refresh,
    signOut,
  })
  const call = () =>
    fetch(ROUTES.listLibraries.path, {
      headers: { [AUTH_HEADERS.authorization]: bearer('old') },
    })
  return { call, sent, signOut }
}

describe('refreshingFetch', () => {
  it('repeats a call the server refused as signed out with the refreshed token', async () => {
    const refresh = mock(
      async () => ({ kind: REFRESH_OUTCOMES.refreshed, accessToken: 'new' }) as const,
    )
    const { call, sent, signOut } = serverTaking({ good: ['new'], refresh })

    const response = await call()

    expect(response.status).toBe(HTTP_STATUSES.ok)
    expect(sent).toEqual([bearer('old'), bearer('new')])
    expect(signOut).not.toHaveBeenCalled()
  })

  it('shares one refresh between calls refused together', async () => {
    const refresh = mock(
      async () => ({ kind: REFRESH_OUTCOMES.refreshed, accessToken: 'new' }) as const,
    )
    const { call } = serverTaking({ good: ['new'], refresh })

    await Promise.all([call(), call(), call()])

    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('signs out when Supabase rejects the refresh, and hands back the refusal', async () => {
    const { call, signOut } = serverTaking({
      good: [],
      refresh: async () => ({ kind: REFRESH_OUTCOMES.rejected }),
    })

    const response = await call()

    expect(response.status).toBe(HTTP_STATUSES.unauthorized)
    expect(signOut).toHaveBeenCalledTimes(1)
  })

  it('leaves the session alone when Supabase cannot be reached', async () => {
    const { call, sent, signOut } = serverTaking({
      good: [],
      refresh: async () => ({ kind: REFRESH_OUTCOMES.unreachable }),
    })

    await call()

    expect(sent).toEqual([bearer('old')])
    expect(signOut).not.toHaveBeenCalled()
  })

  it('signs out when the repeat is refused too', async () => {
    const { call, signOut } = serverTaking({
      good: [],
      refresh: async () => ({ kind: REFRESH_OUTCOMES.refreshed, accessToken: 'new' }),
    })

    await call()

    expect(signOut).toHaveBeenCalledTimes(1)
  })
})
