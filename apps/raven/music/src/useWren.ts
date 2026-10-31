import type { ApiClient } from '@raven/core'
import { apiFor } from '@raven/native'
import { type AppServer, lastPerServer } from '@raven/native/headless'
import { type RavenQueries, ravenQueriesFor } from '@raven/ui/headless'

import { useWrenAccount } from '@/session'
import { useActiveServer } from '@/stores/activeServer'

/** Everything the screens ask raven through: its client and its queries. */
export type WrenSession = { server: AppServer; api: ApiClient; queries: RavenQueries }

const wrenSessionFor = lastPerServer({
  make: (server): WrenSession => {
    const api = apiFor({ server, session: useWrenAccount })
    return { server, api, queries: ravenQueriesFor(api) }
  },
})

/**
 * The active server's client and queries, made once while it stays active; null until a
 * server is. Wren talks to raven alone, so there is one, but an end to end build adds its
 * fixture only once sign-in has passed its PIN.
 */
export const useWren = (): WrenSession | null => {
  const server = useActiveServer(
    (state) => state.servers.find(({ id }) => id === state.activeId) ?? null,
  )
  return server === null ? null : wrenSessionFor(server)
}
