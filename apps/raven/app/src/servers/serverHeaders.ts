import { APP_CALL_METHODS, AUTH_HEADERS } from '@raven/core'

import { checkAppCall } from '@/servers/allowlist'
import { type ServerCookies, cookieHeaderOf } from '@/servers/cookieJar'
import type { AppServer } from '@/servers/serverList'

/** Whether `address` is on the server's own API, the only place its cookies, `Path=/api`, go. */
export const isServerApi = ({ server, address }: { server: AppServer; address: string }): boolean =>
  address.startsWith(`${server.origin}/api/`)

/**
 * The headers a request the app does not make through `fetch` carries to `url`: a picture,
 * the event stream. The server's cookies on its own API, and nothing anywhere else. It
 * throws for a URL outside the app's calls, as the app's `fetch` does, so such a request
 * never gets the cookies.
 */
export const cookieHeadersFor =
  ({ server, cookies }: { server: AppServer; cookies: ServerCookies }) =>
  (url: string): Record<string, string> => {
    checkAppCall({ method: APP_CALL_METHODS.get, url })
    const cookie = isServerApi({ server, address: url }) ? cookieHeaderOf(cookies) : null
    return cookie === null ? {} : { [AUTH_HEADERS.cookie]: cookie }
  }
