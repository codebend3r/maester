import { APP_CALL_METHODS, AUTH_HEADERS, AUTH_SCHEME } from '@raven/core'

import { checkAppCall } from '@/servers/allowlist'
import { type ServerCookies, cookieHeaderOf } from '@/servers/cookieJar'
import type { AppServer } from '@/servers/serverList'

type IsServerApiProps = { server: AppServer; address: string }

/** Whether `address` is on the server's own API, the only place its cookies, `Path=/api`, go. */
export const isServerApi = ({ server, address }: IsServerApiProps): boolean =>
  address.startsWith(`${server.origin}/api/`)

type CookieHeadersForProps = {
  server: AppServer
  cookies: ServerCookies
  /** The signed-in account's token, sent beside the cookies on the server's own API. */
  accessToken?: string | null
}

/**
 * The headers a request the app does not make through `fetch` carries to `url`: a picture,
 * the event stream. The server's cookies and the account's token on its own API, and nothing anywhere else. It
 * throws for a URL outside the app's calls, as the app's `fetch` does, so such a request
 * never gets the cookies.
 */
export const cookieHeadersFor =
  ({ server, cookies, accessToken = null }: CookieHeadersForProps) =>
  (url: string): Record<string, string> => {
    checkAppCall({ method: APP_CALL_METHODS.get, url })
    if (!isServerApi({ server, address: url })) return {}
    const cookie = cookieHeaderOf(cookies)
    return {
      ...(cookie === null ? {} : { [AUTH_HEADERS.cookie]: cookie }),
      ...(accessToken === null
        ? {}
        : { [AUTH_HEADERS.authorization]: `${AUTH_SCHEME} ${accessToken}` }),
    }
  }
