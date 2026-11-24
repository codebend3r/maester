import { cookieJar, openFetch, secretStore } from '@raven/native'
import { RAVEN_SERVER, accountServersFor, createActiveServerStore } from '@raven/native/headless'

import { useAccountSession } from '@/account/session'

/**
 * The servers the app knows, home (`RAVEN_SERVER`) first, and the one it talks to; `AppRoot`
 * hydrates it before any route.
 */
export const useActiveServer = createActiveServerStore({
  store: secretStore,
  jar: cookieJar,
  home: RAVEN_SERVER,
})

/** The account's servers and pins, kept in its database and followed into `useActiveServer`. */
export const accountServers = accountServersFor({
  servers: useActiveServer,
  session: useAccountSession,
  fetch: openFetch,
})
