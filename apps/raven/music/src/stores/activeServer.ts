import { cookieJar, secretStore } from '@raven/native'
import { RAVEN_SERVER, createActiveServerStore } from '@raven/native/headless'

/** The servers Wren knows, home (`RAVEN_SERVER`) first, and the one it talks to; `WrenRoot` hydrates it before any route. */
export const useActiveServer = createActiveServerStore({
  store: secretStore,
  jar: cookieJar,
  home: RAVEN_SERVER,
})
