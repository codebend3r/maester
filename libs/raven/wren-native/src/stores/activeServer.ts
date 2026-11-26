import { cookieJar, openFetch, secretStore } from '@raven/native'
import { RAVEN_SERVER, accountServersFor, createActiveServerStore } from '@raven/native/headless'

import { useWrenAccount } from '@/session'

/** The servers Wren knows, home (`RAVEN_SERVER`) first, and the one it talks to; each Wren's root hydrates it before any route. */
export const useActiveServer: ReturnType<typeof createActiveServerStore> = createActiveServerStore({
  store: secretStore,
  jar: cookieJar,
  home: RAVEN_SERVER,
})

type ActiveServerState = ReturnType<typeof useActiveServer.getState>

/** The active server's configured name, or raven's before one is pinned. */
const serverNameOf = ({ servers, activeId }: ActiveServerState): string =>
  servers.find((server) => server.id === activeId)?.name ?? RAVEN_SERVER.name

/** The active server's name as sign-in shows it, redrawn when it changes. */
export const useActiveServerName = (): string => useActiveServer(serverNameOf)

/**
 * The account's servers and the names it gave them, kept in its database and followed into
 * `useActiveServer`, so the server's name in Wren is the one raven shows on every device.
 */
export const accountServers: ReturnType<typeof accountServersFor> = accountServersFor({
  servers: useActiveServer,
  session: useWrenAccount,
  fetch: openFetch,
})
