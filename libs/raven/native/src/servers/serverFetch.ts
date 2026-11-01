import { AUTH_HEADERS, type FetchInit, type FetchLike, type FetchResponse } from '@raven/core'

import { type CookieJar, cookieHeaderOf, readServerCookies } from '@/servers/cookieJar'
import { isServerApi } from '@/servers/serverHeaders'
import type { AppServer } from '@/servers/serverList'

export const FETCH_CREDENTIALS = { omit: 'omit' } as const

export const RESPONSE_HEADERS = { setCookie: 'set-cookie' } as const

/** What the app hands React Native's `fetch`: a request told to leave cookies alone. */
type NativeFetchProps = FetchInit & { credentials: typeof FETCH_CREDENTIALS.omit }

/**
 * React Native's `fetch` as the app calls it: told to leave cookies alone, with headers to
 * read back and `url`, where the request ended after any redirect ('' when not reported).
 */
export type NativeFetch = (
  url: string,
  init: NativeFetchProps,
) => Promise<FetchResponse & { url: string; headers: { get: (name: string) => string | null } }>

type ServerFetchForProps = {
  server: AppServer
  jar: CookieJar
  fetch: NativeFetch
}

/**
 * The `fetch` a server's `ApiClient` runs on. `credentials: 'omit'` keeps the system's
 * shared cookie store out of it (iOS turns off `HTTPShouldHandleCookies`, Android hands
 * OkHttp no cookie jar), so the app adds the server's own cookies from `jar` and keeps the
 * ones the server sets. Both stay on the server's API, the cookies' `Path=/api`: a media
 * origin's address is never sent them, and neither it nor a redirect to it sets them.
 */
export const serverFetchFor = ({ server, jar, fetch }: ServerFetchForProps): FetchLike => {
  const isOwnApi = (address: string): boolean => isServerApi({ server, address })
  return async (url, init = {}) => {
    const cookie = isOwnApi(url) ? cookieHeaderOf(await jar.read(server.id)) : null
    const headers =
      cookie === null ? init.headers : { ...init.headers, [AUTH_HEADERS.cookie]: cookie }
    // React Native follows redirects natively, carrying the headers it was given, and has no
    // `redirect: 'manual'`, so a hop off the origin cannot be stopped before it is sent the
    // cookies; raven's API never redirects. What a redirect hands back is refused below.
    const response = await fetch(url, {
      ...init,
      ...(headers === undefined ? {} : { headers }),
      credentials: FETCH_CREDENTIALS.omit,
    })
    const landedAt = response.url === '' ? url : response.url
    if (!isOwnApi(url) || !isOwnApi(landedAt)) return response
    const changes = readServerCookies(response.headers.get(RESPONSE_HEADERS.setCookie))
    if (Object.keys(changes).length > 0) await jar.apply({ serverId: server.id, changes })
    return response
  }
}
