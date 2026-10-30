import { cookieJar, secretStore } from '@raven/native'
import { createActiveServerStore } from '@raven/native/headless'

/** The server Wren talks to, raven itself; `WrenRoot` hydrates it before any route. */
export const useActiveServer = createActiveServerStore({ store: secretStore, jar: cookieJar })
