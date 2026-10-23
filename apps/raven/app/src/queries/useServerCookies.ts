import { useEffect, useState } from 'react'

import type { ServerCookies } from '@/servers/cookieJar'
import { cookieJar } from '@/servers/serverClient'
import type { AppServer } from '@/servers/serverList'
import { useCookieVersion } from '@/stores/cookieVersion'

/**
 * The server's cookies, for what the app sends outside `fetch`; null until the jar first
 * answers. They are read again whenever the jar changes, as after an unlock, and the last
 * ones stand meanwhile.
 */
export const useServerCookies = (server: AppServer): ServerCookies | null => {
  const [read, setRead] = useState<{ serverId: string; cookies: ServerCookies } | null>(null)
  useEffect(() => {
    const status = { isCurrent: true }
    const readJar = () => {
      void cookieJar.read(server.id).then((cookies) => {
        if (status.isCurrent) setRead({ serverId: server.id, cookies })
      })
    }
    readJar()
    const stopListening = useCookieVersion.subscribe(readJar)
    return () => {
      status.isCurrent = false
      stopListening()
    }
  }, [server])
  return read !== null && read.serverId === server.id ? read.cookies : null
}
