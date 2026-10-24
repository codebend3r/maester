import { APP_CALL_METHODS, AUTH_API_PREFIX, AUTH_HEADERS, AUTH_SCHEME } from '@raven/core'

import { checkAppCall } from '@/servers/allowlist'
import { type ServerCookies, cookieHeaderOf } from '@/servers/cookieJar'
import type { AppServer } from '@/servers/serverList'

/**
 * What the app sends a server's own API besides the call: its cookies, and the account's
 * access token on a server that signs in with accounts, null for none.
 */
export type ServerCredentials = { cookies: ServerCookies; token: string | null }

/** Whether `address` is on the server's own API, the only place its credentials go. */
export const isServerApi = ({ server, address }: { server: AppServer; address: string }): boolean =>
  address.startsWith(`${server.origin}${AUTH_API_PREFIX}`)

/** The `Authorization` header that hands the server the account's access token. */
export const bearerHeaderOf = (token: string): Record<string, string> => ({
  [AUTH_HEADERS.authorization]: `${AUTH_SCHEME} ${token}`,
})

/**
 * The headers a request the app does not make through `fetch` carries to `url`: a picture, the
 * event stream, a video played from the server's own address. The server's cookies and the
 * account's Bearer on its own API, and nothing anywhere else. It throws for a URL outside the
 * app's calls, as the app's `fetch` does, so such a request is never sent them.
 */
export const serverHeadersFor =
  ({ server, credentials }: { server: AppServer; credentials: ServerCredentials }) =>
  (url: string): Record<string, string> => {
    checkAppCall({ method: APP_CALL_METHODS.get, url })
    if (!isServerApi({ server, address: url })) return {}
    const cookie = cookieHeaderOf(credentials.cookies)
    return {
      ...(cookie === null ? {} : { [AUTH_HEADERS.cookie]: cookie }),
      ...(credentials.token === null ? {} : bearerHeaderOf(credentials.token)),
    }
  }
