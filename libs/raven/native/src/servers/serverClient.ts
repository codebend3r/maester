import { type ApiClient, createApiClient } from '@raven/core'
import { AppState } from 'react-native'
import EventSource from 'react-native-sse'

import { type AccountSessionStore, accessTokenNow } from '@/account/accountSession'
import { refreshingFetch } from '@/account/refreshingFetch'
import { allowlistedFetch } from '@/servers/allowlist'
import { createCookieJar } from '@/servers/cookieJar'
import {
  APP_STATES,
  APP_STATE_EVENTS,
  eventSourceFor,
  isForegroundState,
} from '@/servers/eventSource'
import { secretStore } from '@/servers/deviceSecretStore'
import { serverFetchFor } from '@/servers/serverFetch'
import { cookieHeadersFor } from '@/servers/serverHeaders'
import type { AppServer } from '@/servers/serverList'
import { bumpCookieVersion } from '@/stores/cookieVersion'

/** Every server's cookies. */
export const cookieJar = createCookieJar({ store: secretStore, onChange: bumpCookieVersion })

export type ApiForProps = {
  server: AppServer
  /** The account whose token the calls carry, refreshed once when the server answers 401. */
  session: AccountSessionStore
}

/** The client for one server, in its own session: its cookies and no other, and only the app's calls. */
export const apiFor = ({ server, session }: ApiForProps): ApiClient =>
  createApiClient({
    baseUrl: server.origin,
    accessToken: () => accessTokenNow({ session }),
    fetch: allowlistedFetch({
      fetch: refreshingFetch({
        fetch: serverFetchFor({ server, jar: cookieJar, fetch }),
        refresh: () => session.getState().refresh(),
      }),
    }),
  })

type HeadersForProps = ApiForProps & { url: string }

/** What a request made outside `fetch` (a picture, the event stream) sends to `url` on `server`. */
const headersFor = async ({
  server,
  session,
  url,
}: HeadersForProps): Promise<Record<string, string>> =>
  cookieHeadersFor({
    server,
    cookies: await cookieJar.read(server.id),
    accessToken: accessTokenNow({ session }),
  })(url)

type OpenEventsForProps = ApiForProps

/** The server's event stream, over `react-native-sse`, with its cookies, kept open while the app is. */
export const openEventsFor = ({ server, session }: OpenEventsForProps) =>
  eventSourceFor({
    headersFor: (url) => headersFor({ server, session, url }),
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
