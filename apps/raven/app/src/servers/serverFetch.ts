import {
  AUTH_HEADERS,
  AUTH_REFUSALS,
  type FetchInit,
  type FetchLike,
  type FetchResponse,
  refusalAt,
} from '@raven/core'

import { type CookieJar, cookieHeaderOf, readServerCookies } from '@/servers/cookieJar'
import { bearerHeaderOf, isServerApi } from '@/servers/serverHeaders'
import type { AppServer } from '@/servers/serverList'

export const FETCH_CREDENTIALS = { omit: 'omit' } as const

export const RESPONSE_HEADERS = { setCookie: 'set-cookie' } as const

/** What a server answers a call whose token it no longer takes. */
const UNAUTHORIZED_STATUS = 401

type NativeResponse = FetchResponse & {
  url: string
  headers: { get: (name: string) => string | null }
}

/**
 * React Native's `fetch` as the app calls it: told to leave cookies alone, with headers to
 * read back and `url`, where the request ended after any redirect ('' when not reported).
 */
export type NativeFetch = (
  url: string,
  init: FetchInit & { credentials: typeof FETCH_CREDENTIALS.omit },
) => Promise<NativeResponse>

/**
 * The account's part of a server's calls. `token` is what the next call carries, null on a
 * server without accounts or with nobody signed in; `refresh` renews it once the server refuses
 * it as `signed_out`, null when it cannot; `rejected` hears that the renewed one was refused too.
 */
export type ServerBearer = {
  token: () => Promise<string | null>
  refresh: () => Promise<string | null>
  rejected: () => Promise<void>
}

/** A response whose body has been read, handed on with that body to read again. */
const withBody = ({
  response,
  body,
}: {
  response: NativeResponse
  body: string
}): NativeResponse => ({
  ok: response.ok,
  status: response.status,
  statusText: response.statusText,
  url: response.url,
  headers: response.headers,
  json: async (): Promise<unknown> => JSON.parse(body),
  text: async () => body,
})

/** A refusal the server gave because the token it was sent no longer stands, read off its body. */
const signedOutOf = async (
  response: NativeResponse,
): Promise<{ isSignedOut: boolean; response: NativeResponse }> => {
  if (response.status !== UNAUTHORIZED_STATUS) return { isSignedOut: false, response }
  const body = await response.text()
  const reason = refusalAt({ status: response.status, body, statuses: [UNAUTHORIZED_STATUS] })
  return { isSignedOut: reason === AUTH_REFUSALS.signedOut, response: withBody({ response, body }) }
}

/**
 * The `fetch` a server's `ApiClient` runs on. `credentials: 'omit'` keeps the system's
 * shared cookie store out of it (iOS turns off `HTTPShouldHandleCookies`, Android hands
 * OkHttp no cookie jar), so the app adds the server's own cookies from `jar` and keeps the
 * ones the server sets, and adds the account's Bearer from `bearer`. All of them stay on the
 * server's API, the cookies' `Path=/api`: a media origin's address is never sent them, and
 * neither it nor a redirect to it sets a cookie. A call the server refuses as `signed_out`
 * goes once more with a refreshed token; refused again, the account is signed out.
 */
export const serverFetchFor = ({
  server,
  jar,
  bearer,
  fetch,
}: {
  server: AppServer
  jar: CookieJar
  bearer: ServerBearer
  fetch: NativeFetch
}): FetchLike => {
  const isOwnApi = (address: string): boolean => isServerApi({ server, address })

  const send = async ({
    url,
    init,
    token,
  }: {
    url: string
    init: FetchInit
    token: string | null
  }): Promise<NativeResponse> => {
    const cookie = cookieHeaderOf(await jar.read(server.id))
    const headers = {
      ...init.headers,
      ...(cookie === null ? {} : { [AUTH_HEADERS.cookie]: cookie }),
      ...(token === null ? {} : bearerHeaderOf(token)),
    }
    // React Native follows redirects natively, carrying the headers it was given, and has no
    // `redirect: 'manual'`, so a hop off the origin cannot be stopped before it is sent the
    // credentials; raven's API never redirects. What a redirect hands back is refused below.
    const response = await fetch(url, {
      ...init,
      ...(Object.keys(headers).length === 0 ? {} : { headers }),
      credentials: FETCH_CREDENTIALS.omit,
    })
    const landedAt = response.url === '' ? url : response.url
    if (!isOwnApi(landedAt)) return response
    const changes = readServerCookies(response.headers.get(RESPONSE_HEADERS.setCookie))
    if (Object.keys(changes).length > 0) await jar.apply({ serverId: server.id, changes })
    return response
  }

  return async (url, init = {}) => {
    if (!isOwnApi(url)) return fetch(url, { ...init, credentials: FETCH_CREDENTIALS.omit })
    const token = await bearer.token()
    const first = await send({ url, init, token })
    if (token === null) return first
    const refused = await signedOutOf(first)
    if (!refused.isSignedOut) return refused.response
    const fresh = await bearer.refresh()
    if (fresh === null) return refused.response
    const second = await signedOutOf(await send({ url, init, token: fresh }))
    if (second.isSignedOut) await bearer.rejected()
    return second.response
  }
}
