import { type ApiClient, createApiClient } from '@raven/core'
import { randomUUID } from 'expo-crypto'
import * as SecureStore from 'expo-secure-store'
import { AppState } from 'react-native'
import EventSource from 'react-native-sse'

import {
  accountBearer,
  createAccountSessions,
  refreshWhileActive,
} from '@/accounts/accountSessions'
import { createSessionStore } from '@/accounts/sessionStore'
import { allowlistedFetch } from '@/servers/allowlist'
import { createCookieJar } from '@/servers/cookieJar'
import {
  APP_STATES,
  APP_STATE_EVENTS,
  type AppActivity,
  eventSourceFor,
  isActiveState,
  isForegroundState,
} from '@/servers/eventSource'
import type { SecretStore } from '@/servers/secretStore'
import { FETCH_CREDENTIALS, type ServerBearer, serverFetchFor } from '@/servers/serverFetch'
import { type ServerCredentials, serverHeadersFor } from '@/servers/serverHeaders'
import type { AppServer } from '@/servers/serverList'
import { hasAccountsNow } from '@/stores/accountAnswers'
import { noteSession } from '@/stores/accountState'
import { bumpCookieVersion } from '@/stores/cookieVersion'

/** The keychain on Apple, which tvOS keeps as well, and the keystore on Android. */
export const secretStore: SecretStore = SecureStore

/** Every server's cookies. */
export const cookieJar = createCookieJar({ store: secretStore, onChange: bumpCookieVersion })

/**
 * Every server's account session, each one JSON value in the keychain. Auth is reached with the
 * app's own fetch, so the system's cookie store stays out of it as it does of the server's.
 */
export const accountSessions = createAccountSessions({
  store: createSessionStore({ store: secretStore }),
  fetch: ({ url, init }) => fetch(url, { ...init, credentials: FETCH_CREDENTIALS.omit }),
  onChange: noteSession,
})

export const newServerId = (): string => randomUUID()

/** `AppState`, read as `isForegroundIn` says which of its states count. */
const appActivityFor = (isForegroundIn: (state: string) => boolean): AppActivity => ({
  // Before React Native has heard from the system it reports no state; the app is opening.
  isForeground: () => isForegroundIn(AppState.currentState ?? APP_STATES.active),
  watch: (onChange) => {
    const subscription = AppState.addEventListener(APP_STATE_EVENTS.change, (state) =>
      onChange(isForegroundIn(state)),
    )
    return () => subscription.remove()
  },
})

/** Renews every account session ahead of its expiry while the app is active; returns a stop. */
export const keepSessionsFresh = (): (() => void) =>
  refreshWhileActive({ sessions: accountSessions, app: appActivityFor(isActiveState) })

const bearerFor = (server: AppServer): ServerBearer =>
  accountBearer({ sessions: accountSessions, server, hasAccounts: () => hasAccountsNow(server) })

/**
 * The client for one server, in its own session: its cookies and no other, its account's Bearer
 * while it signs in with accounts, only the app's calls, and none of the admin lock's then.
 */
export const apiFor = (server: AppServer): ApiClient =>
  createApiClient({
    baseUrl: server.origin,
    fetch: allowlistedFetch({
      fetch: serverFetchFor({ server, jar: cookieJar, bearer: bearerFor(server), fetch }),
      hasAccounts: () => hasAccountsNow(server),
    }),
  })

/** What the app sends `server`'s own API outside `fetch`: its cookies and the account's token. */
export const credentialsFor = async (server: AppServer): Promise<ServerCredentials> => {
  const [cookies, token] = await Promise.all([cookieJar.read(server.id), bearerFor(server).token()])
  return { cookies, token }
}

/** What a request made outside `fetch` (a picture, the event stream) sends to `url` on `server`. */
const headersFor = async ({
  server,
  url,
}: {
  server: AppServer
  url: string
}): Promise<Record<string, string>> =>
  serverHeadersFor({ server, credentials: await credentialsFor(server) })(url)

/** The server's event stream, over `react-native-sse`, with its credentials, kept open while the app is. */
export const openEventsFor = (server: AppServer) =>
  eventSourceFor({
    headersFor: (url) => headersFor({ server, url }),
    createSource: ({ url, headers }) => new EventSource(url, { headers }),
    schedule: ({ run, ms }) => {
      const timer = setTimeout(run, ms)
      return () => clearTimeout(timer)
    },
    app: appActivityFor(isForegroundState),
  })
