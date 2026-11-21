import { HTTP_STATUSES } from '@shared/http'
import { type FetchInit, type FetchResponse } from '@/apiClient'
import { AUTH_HEADERS, AUTH_REFUSALS, AUTH_SCHEME, isAuthRefusal } from '@/contract'

export const REFRESH_OUTCOMES = {
  refreshed: 'refreshed',
  rejected: 'rejected',
  unreachable: 'unreachable',
} as const

/** How asking Supabase for a new access token ended. */
export type RefreshOutcome =
  | { kind: typeof REFRESH_OUTCOMES.refreshed; accessToken: string }
  | { kind: typeof REFRESH_OUTCOMES.rejected }
  | { kind: typeof REFRESH_OUTCOMES.unreachable }

/**
 * What the refreshing fetch reads of an answer: its status, and a copy whose body it may read
 * while the caller still reads the answer's own. A browser's `Response` is one.
 */
type RefusableResponse = Pick<FetchResponse, 'status'> & {
  clone: () => Pick<FetchResponse, 'json'>
}

const isSignedOutRefusal = async (response: RefusableResponse): Promise<boolean> => {
  if (response.status !== HTTP_STATUSES.unauthorized) return false
  const body: unknown = await response
    .clone()
    .json()
    .catch(() => null)
  return isAuthRefusal(body) && body.reason === AUTH_REFUSALS.signedOut
}

/** One run of `task` at a time: a caller that arrives while it runs gets the same promise. */
const shared = <T>(task: () => Promise<T>): (() => Promise<T>) => {
  let running: Promise<T> | null = null
  return () => {
    running ??= task().finally(() => {
      running = null
    })
    return running
  }
}

const bearer = (token: string): string => `${AUTH_SCHEME} ${token}`

type RefreshingFetchProps<Answer extends RefusableResponse> = {
  fetch: (url: string, init?: FetchInit) => Promise<Answer>
  accessToken: () => string | null
  refresh: () => Promise<RefreshOutcome>
  signOut: () => Promise<void>
}

/**
 * A `fetch` that answers a `signed_out` refusal of a call carrying a token
 * with one refresh and one repeat of that call. It sits under the API
 * client, which reads the refusal off the response it returns, so every call
 * gets the retry without knowing about it. Calls refused together share one
 * refresh; a call refused after a token newer than its own exists repeats
 * with that token. A repeat refused again, or a refresh Supabase rejects,
 * signs out; a refresh that cannot reach Supabase leaves the session alone.
 */
export const refreshingFetch = <Answer extends RefusableResponse>({
  fetch,
  accessToken,
  refresh,
  signOut,
}: RefreshingFetchProps<Answer>) => {
  const refreshOnce = shared(refresh)
  const signOutOnce = shared(signOut)

  /** The token to repeat a refused call with, or null when there is none to try. */
  const tokenAfterRefusal = async (sent: string): Promise<string | null> => {
    const current = accessToken()
    if (current !== null && sent !== bearer(current)) return current
    const outcome = await refreshOnce()
    switch (outcome.kind) {
      case REFRESH_OUTCOMES.refreshed:
        return outcome.accessToken
      case REFRESH_OUTCOMES.rejected:
        await signOutOnce()
        return null
      case REFRESH_OUTCOMES.unreachable:
        return null
      default: {
        const unreachable: never = outcome
        return unreachable
      }
    }
  }

  return async (url: string, init?: FetchInit): Promise<Answer> => {
    const response = await fetch(url, init)
    const sent = init?.headers?.[AUTH_HEADERS.authorization] ?? null
    if (sent === null || !(await isSignedOutRefusal(response))) return response

    const token = await tokenAfterRefusal(sent)
    if (token === null) return response

    const headers = init?.headers ?? {}
    const repeated = await fetch(url, {
      ...init,
      headers: { ...headers, [AUTH_HEADERS.authorization]: bearer(token) },
    })
    if (await isSignedOutRefusal(repeated)) await signOutOnce()
    return repeated
  }
}
