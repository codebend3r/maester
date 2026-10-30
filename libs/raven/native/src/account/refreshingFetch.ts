import { AUTH_HEADERS, AUTH_SCHEME, type FetchLike } from '@raven/core'

const SIGNED_OUT_STATUS = 401

type RefreshingFetchProps = { fetch: FetchLike; refresh: () => Promise<string | null> }

/**
 * A `fetch` that answers a 401 to a call carrying a token with one refresh and one repeat of
 * that call. It sits under the API client, which reads the refusal off the response it hands
 * back, so every call gets the retry without knowing of it. A repeat refused again is returned
 * as it is.
 */
export const refreshingFetch =
  ({ fetch, refresh }: RefreshingFetchProps): FetchLike =>
  async (url, init = {}) => {
    const response = await fetch(url, init)
    const isSigned = (init.headers?.[AUTH_HEADERS.authorization] ?? null) !== null
    if (response.status !== SIGNED_OUT_STATUS || !isSigned) return response
    const token = await refresh()
    if (token === null) return response
    return fetch(url, {
      ...init,
      headers: { ...init.headers, [AUTH_HEADERS.authorization]: `${AUTH_SCHEME} ${token}` },
    })
  }
