import { cookieJar } from '@raven/native'
import { serverHeadersFor } from '@raven/native/headless'

import { useAccountSession } from '@/account/session'
import type { Pictures } from '@/queries/cards'
import type { AppQueries } from '@/queries/useAppQueries'

const useServerHeaders = serverHeadersFor({ session: useAccountSession, jar: cookieJar })

type UsePicturesProps = Pick<AppQueries, 'server' | 'api'>

/**
 * Where a screen's pictures come from on the active server, with the headers each request for
 * one carries: the server's cookies and the account's token, on its own API only. Null until the
 * jar has first answered, so a screen waits and no picture is asked for twice; it follows the
 * jar's changes (an unlock) and the token's refresh.
 */
export const usePictures = ({ server, api }: UsePicturesProps): Pictures | null => {
  const headersFor = useServerHeaders({ server })
  return headersFor === null ? null : { api, headersFor }
}
