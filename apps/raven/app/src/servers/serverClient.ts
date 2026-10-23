import { type ApiClient, createApiClient } from '@raven/core'
import { randomUUID } from 'expo-crypto'
import * as SecureStore from 'expo-secure-store'
import { AppState } from 'react-native'
import EventSource from 'react-native-sse'

import { allowlistedFetch } from '@/servers/allowlist'
import { createCookieJar } from '@/servers/cookieJar'
import { APP_STATES, eventSourceFor, isForegroundState } from '@/servers/eventSource'
import type { SecretStore } from '@/servers/secretStore'
import { serverFetchFor } from '@/servers/serverFetch'
import { cookieHeadersFor } from '@/servers/serverHeaders'
import type { AppServer } from '@/servers/serverList'
import { bumpCookieVersion } from '@/stores/cookieVersion'

/** The keychain on Apple, which tvOS keeps as well, and the keystore on Android. */
export const secretStore: SecretStore = SecureStore

/** Every server's cookies. */
export const cookieJar = createCookieJar({ store: secretStore, onChange: bumpCookieVersion })

export const newServerId = (): string => randomUUID()

/** The client for one server, in its own session: its cookies and no other, and only the app's calls. */
export const apiFor = (server: AppServer): ApiClient =>
  createApiClient({
    baseUrl: server.origin,
    fetch: allowlistedFetch({ fetch: serverFetchFor({ server, jar: cookieJar, fetch }) }),
  })

/** What a request made outside `fetch` (a picture, the event stream) sends to `url` on `server`. */
const headersFor = async ({
  server,
  url,
}: {
  server: AppServer
  url: string
}): Promise<Record<string, string>> =>
  cookieHeadersFor({ server, cookies: await cookieJar.read(server.id) })(url)

const APP_STATE_EVENTS = { change: 'change' } as const

/** The server's event stream, over `react-native-sse`, with its cookies, kept open while the app is. */
export const openEventsFor = (server: AppServer) =>
  eventSourceFor({
    headersFor: (url) => headersFor({ server, url }),
    createSource: ({ url, headers }) => new EventSource(url, { headers }),
    schedule: ({ run, ms }) => {
      const timer = setTimeout(run, ms)
      return () => clearTimeout(timer)
    },
    app: {
      // Before React Native has heard from the system it reports no state; the app is opening.
      isForeground: () => isForegroundState(AppState.currentState ?? APP_STATES.active),
      watch: (onChange) => {
        const subscription = AppState.addEventListener(APP_STATE_EVENTS.change, (state) =>
          onChange(isForegroundState(state)),
        )
        return () => subscription.remove()
      },
    },
  })
