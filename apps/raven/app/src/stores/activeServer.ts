import { cookieJar, secretStore } from '@raven/native'
import { createActiveServerStore } from '@raven/native/headless'

/** The servers the app knows and the one it talks to; `AppRoot` hydrates it before any route. */
export const useActiveServer = createActiveServerStore({ store: secretStore, jar: cookieJar })
