import { useEffect } from 'react'

import type { CookieJar, ServerCookies } from '@/servers/cookieJar'
import { noteCookies, useCookieSnapshots } from '@/stores/cookieSnapshots'
import { useCookieVersion } from '@/stores/cookieVersion'

type UseServerCookiesProps = { serverId: string; jar: Pick<CookieJar, 'read'> }

const IGNORED = (): void => undefined

/**
 * The server's cookies as the jar last held them, for what an app sends outside `fetch`; null
 * until the jar first answers. They are read again whenever the jar changes, as after an
 * unlock, and the last ones stand meanwhile.
 */
export const useServerCookies = ({
  serverId,
  jar,
}: UseServerCookiesProps): ServerCookies | null => {
  const cookies = useCookieSnapshots((state) => state.byServer[serverId] ?? null)
  useEffect(() => {
    // The jar reads as empty when its store fails, so a rejection only keeps the last ones.
    const readJar = () => {
      jar.read(serverId).then((read) => noteCookies({ serverId, cookies: read }), IGNORED)
    }
    readJar()
    return useCookieVersion.subscribe(readJar)
  }, [serverId, jar])
  return cookies
}
