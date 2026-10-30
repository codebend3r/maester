import { cookieJar } from '@raven/native'
import { cookieHeadersFor, useServerCookies } from '@raven/native/headless'

import { useAccountSession } from '@/account/session'
import type { Pictures } from '@/queries/cards'
import type { AppQueries } from '@/queries/useAppQueries'

type UsePicturesProps = Pick<AppQueries, 'server' | 'api'>

/**
 * Where a screen's pictures come from on the active server, with the headers each request for
 * one carries: the server's cookies and the account's token, on its own API only. Null until the
 * jar has first answered, so a screen waits and no picture is asked for twice; it follows the
 * jar's changes (an unlock) and the token's refresh.
 */
export const usePictures = ({ server, api }: UsePicturesProps): Pictures | null => {
  const cookies = useServerCookies({ server, jar: cookieJar })
  const accessToken = useAccountSession((state) => state.session?.accessToken ?? null)
  if (cookies === null) return null
  return { api, headersFor: cookieHeadersFor({ server, cookies, accessToken }) }
}
