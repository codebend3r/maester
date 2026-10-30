import type { ApiClient } from '@raven/core'
import { apiFor, openEventsFor } from '@raven/native'
import type { AppServer } from '@raven/native/headless'
import { type RavenQueries, ravenQueriesFor, serverEventsFor } from '@raven/ui/headless'

import { useAccountSession } from '@/account/session'
import { lastPerServer } from '@/queries/perServer'
import { useActiveServer } from '@/stores/activeServer'

/** Everything the screens ask one server through: its client, its queries and its events. */
export type AppQueries = {
  server: AppServer
  api: ApiClient
  queries: RavenQueries
  useServerEvents: () => void
}

const appQueriesFor = lastPerServer({
  make: (server): AppQueries => {
    const api = apiFor({ server, session: useAccountSession })
    const { useServerEvents } = serverEventsFor({
      api,
      openEvents: openEventsFor({ server, session: useAccountSession }),
    })
    return { server, api, queries: ravenQueriesFor(api), useServerEvents }
  },
})

/**
 * The active server's client and queries, made once while it stays active; null before
 * sign-in. A screen that reads a server reads it through this, so it renders again on a
 * switch and asks the new one.
 */
export const useAppQueries = (): AppQueries | null => {
  const server = useActiveServer(
    (state) => state.servers.find(({ id }) => id === state.activeId) ?? null,
  )
  return server === null ? null : appQueriesFor(server)
}
