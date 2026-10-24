import { createActiveServerStore } from '@/servers/activeServerStore'
import { accountSessions, cookieJar, secretStore } from '@/servers/serverClient'

/** The servers the app knows and the one it talks to; `AppRoot` hydrates it before any route. */
export const useActiveServer = createActiveServerStore({
  store: secretStore,
  jar: cookieJar,
  sessions: accountSessions,
})
