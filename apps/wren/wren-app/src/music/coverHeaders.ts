import { accessTokenNow, cookieJar } from '@raven/native'
import { type AppServer, cookieHeadersFor } from '@raven/native/headless'

import { useWrenAccount } from '@/session'

type CoverHeadersOfProps = { server: AppServer; uri: string }

/**
 * The headers a cover's request to `uri` carries, read now: the server's cookies and the
 * account's token, as `useCovers` sends them, for a request made outside the screens.
 */
export const coverHeadersOf = async ({
  server,
  uri,
}: CoverHeadersOfProps): Promise<Record<string, string>> =>
  cookieHeadersFor({
    server,
    cookies: await cookieJar.read(server.id),
    accessToken: accessTokenNow({ session: useWrenAccount }),
  })(uri)
