import { useEffect, useState } from 'react'

import { credentialsFor } from '@/servers/serverClient'
import type { ServerCredentials } from '@/servers/serverHeaders'
import type { AppServer } from '@/servers/serverList'
import { useAccountState } from '@/stores/accountState'
import { useCookieVersion } from '@/stores/cookieVersion'

/**
 * The server's cookies and its account's token, for what the app sends outside `fetch`; null
 * until they are first read. They are read again whenever the jar changes, as after an unlock,
 * or a session does, as after a sign in or a refresh, and the last ones stand meanwhile.
 */
export const useServerCredentials = (server: AppServer): ServerCredentials | null => {
  const [read, setRead] = useState<{ serverId: string; credentials: ServerCredentials } | null>(
    null,
  )
  useEffect(() => {
    const status = { isCurrent: true }
    const readAgain = () => {
      // The jar and the sessions read as empty when their store fails, so a rejection only
      // keeps the last ones.
      credentialsFor(server).then(
        (credentials) => {
          if (status.isCurrent) setRead({ serverId: server.id, credentials })
        },
        () => undefined,
      )
    }
    readAgain()
    const stopJar = useCookieVersion.subscribe(readAgain)
    const stopSessions = useAccountState.subscribe((state, previous) => {
      if (state.version !== previous.version) readAgain()
    })
    return () => {
      status.isCurrent = false
      stopJar()
      stopSessions()
    }
  }, [server])
  return read !== null && read.serverId === server.id ? read.credentials : null
}
