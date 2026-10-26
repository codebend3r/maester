import type { AuthChangeEvent } from '@supabase/supabase-js'
import { act, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, spyOn } from 'bun:test'
import { AUTH_HEADERS, AUTH_SCHEME } from '@raven/core'
import { AUTH_SESSION_STATUSES, useAuthSession } from '@/stores/authSession'
import { fakeAuthClient, fakeSession, readyConfig } from '@/test/authClient'

const AUTH_CHANGES = { signedIn: 'SIGNED_IN' } as const satisfies Record<string, AuthChangeEvent>

export const TEST_ACCOUNTS = {
  ada: { userId: 'ada-account', accessToken: 'ada-token' },
  bo: { userId: 'bo-account', accessToken: 'bo-token' },
} as const

type TestAccount = (typeof TEST_ACCOUNTS)[keyof typeof TEST_ACCOUNTS]

export const bearerOf = (account: TestAccount): string => `${AUTH_SCHEME} ${account.accessToken}`

type ApiRequest = { path: string; authorization: string | null }

type Answer = (request: ApiRequest) => Promise<unknown>

/** A server that has not replied yet. */
export const unanswered = (): Promise<never> => new Promise(() => undefined)

export const authorizations = (requests: readonly ApiRequest[]): (string | null)[] =>
  requests.map(({ authorization }) => authorization)

type ExpectEveryCallAsProps = {
  requests: readonly ApiRequest[]
  account: TestAccount
}

/** At least one call went out, and every one carried `account`'s token. */
export const expectEveryCallAs = ({ requests, account }: ExpectEveryCallAsProps): void => {
  expect(new Set(authorizations(requests))).toEqual(new Set([bearerOf(account)]))
}

/**
 * Stands in for the server's `fetch` in the tests of the calling describe,
 * recording every call. `serve` picks the answers per test; whatever it does
 * not answer stays pending.
 */
export const useRecordedApi = () => {
  const state: { answer: Answer; requests: ApiRequest[]; restore: () => void } = {
    answer: unanswered,
    requests: [],
    restore: () => undefined,
  }
  beforeEach(() => {
    state.answer = unanswered
    state.requests = []
    const spy = spyOn(window, 'fetch').mockImplementation(
      Object.assign(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const request: ApiRequest = {
            path: new URL(String(input), window.location.href).pathname,
            authorization: new Headers(init?.headers ?? {}).get(AUTH_HEADERS.authorization),
          }
          state.requests = [...state.requests, request]
          return Response.json(await state.answer(request))
        },
        { preconnect: () => undefined },
      ),
    )
    state.restore = () => spy.mockRestore()
  })
  afterEach(() => state.restore())
  return {
    serve: (answer: Answer) => {
      state.answer = answer
    },
    requests: () => state.requests,
  }
}

type SignInThroughProps = { account: TestAccount }

/** Signs `account` in through a fake Supabase client, which can then switch the browser to another. */
export const signInThrough = async ({ account }: SignInThroughProps) => {
  const fake = fakeAuthClient({ session: fakeSession(account) })
  useAuthSession.getState().start({ config: readyConfig, createClient: () => fake.client })
  await waitFor(() => expect(useAuthSession.getState().status).toBe(AUTH_SESSION_STATUSES.ready))
  type SignInThroughSwitchToProps = { next: TestAccount }

  return {
    switchTo: ({ next }: SignInThroughSwitchToProps) =>
      act(() => fake.emit({ event: AUTH_CHANGES.signedIn, session: fakeSession(next) })),
  }
}
