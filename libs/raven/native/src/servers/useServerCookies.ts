import { useEffect, useState } from 'react'

import type { CookieJar, ServerCookies } from '@/servers/cookieJar'
import type { AppServer } from '@/servers/serverList'
import { useCookieVersion } from '@/stores/cookieVersion'

type UseServerCookiesProps = { server: AppServer; jar: Pick<CookieJar, 'read'> }

/**
 * The server's cookies from `jar`, for what an app sends outside `fetch`; null until the jar
 * first answers. They are read again whenever the jar changes, as after an unlock, and the last
 * ones stand meanwhile.
 */
export const useServerCookies = ({ server, jar }: UseServerCookiesProps): ServerCookies | null => {
  const [read, setRead] = useState<{ serverId: string; cookies: ServerCookies } | null>(null)
  useEffect(() => {
    const status = { isCurrent: true }
    const readJar = () => {
      // The jar reads as empty when its store fails, so a rejection only keeps the last ones.
      jar.read(server.id).then(
        (cookies) => {
          if (status.isCurrent) setRead({ serverId: server.id, cookies })
        },
        () => undefined,
      )
    }
    readJar()
    const stopListening = useCookieVersion.subscribe(readJar)
    return () => {
      status.isCurrent = false
      stopListening()
    }
  }, [server, jar])
  return read !== null && read.serverId === server.id ? read.cookies : null
}
