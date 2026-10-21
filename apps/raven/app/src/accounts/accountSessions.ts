import {
  AUTH_HEADERS,
  AUTH_V1,
  type SignInConfig,
  type SignInOutcomeKind,
  SIGN_IN_OUTCOMES,
  isSameSignIn,
  isString,
  object,
  signInOutcomeOf,
} from '@raven/core'
import {
  type AuthError,
  AuthClient,
  isAuthApiError,
  isAuthRefreshDiscardedError,
  isAuthSessionMissingError,
} from '@supabase/auth-js'

import type { SessionStorage, SessionStore } from '@/accounts/sessionStore'
import type { AppActivity } from '@/servers/eventSource'
import type { ServerBearer } from '@/servers/serverFetch'
import type { AppServer } from '@/servers/serverList'

/** The fetch auth-js calls Supabase Auth with: the app's own, keeping the system's cookies out. */
export type AuthFetch = (input: { url: string; init: RequestInit }) => Promise<Response>

/** Where auth-js keeps a server's session among that server's items. */
export const SESSION_STORAGE_KEY = 'raven-app-session'

/** What the app is told each time a server's session is restored or written: never the session. */
export type SessionChange = { serverId: string; isSignedIn: boolean }

/** The part of a server its account session follows: its id and the sign-in pinned for it. */
type AccountServer = Pick<AppServer, 'id' | 'account'>

export type AccountSessions = {
  /** Signs in at exactly `account`, the endpoints the caller has just read and vouched for. */
  signIn: (input: {
    server: Pick<AppServer, 'id'>
    account: SignInConfig
    email: string
    password: string
  }) => Promise<SignInOutcomeKind>
  /** The token to send the server, renewed first when it is about to run out; null for none. */
  accessToken: (input: { server: AccountServer }) => Promise<string | null>
  /** A fresh token after the server refused the last one; null, and signed out when Auth refused. */
  refresh: (input: { server: AccountServer }) => Promise<string | null>
  /**
   * Ends the sign-in at Auth, on this device alone, as far as Auth answers, and forgets it here
   * either way.
   */
  signOut: (input: { server: AccountServer }) => Promise<void>
  /** Forgets a server's sign-in without asking Auth: the server is gone, or its sign-in moved. */
  forget: (input: { serverId: string }) => Promise<void>
  /** Reads each server's kept session once at launch, so whether it is signed in is known. */
  restore: (input: { serverIds: readonly string[] }) => Promise<void>
  /**
   * Has auth-js renew each session ahead of its expiry while `isOn`, every client held now and
   * every one made later, as its React Native guidance asks: on while the app is active, off in
   * the background.
   */
  autoRefresh: (input: { isOn: boolean }) => void
}

/**
 * How long a token read or a refresh waits on Auth. auth-js retries an unreachable refresh for
 * up to 30 s; past this the call goes as it is and the retry goes on alone.
 */
const AUTH_DEADLINE_MS = 5000

/** How far a sign out reaches: `local` ends this device's session alone. */
export const SIGN_OUT_SCOPES = { local: 'local' } as const

/** auth-js could not start or stop its timer: the next turn of the app asks again. */
const AUTO_REFRESH_IGNORED = (): void => undefined

/** The part of a kept session that says it is one auth-js could use. */
const isStoredSession = object({ access_token: isString, refresh_token: isString })

const isSessionValue = (value: string | null): boolean => {
  if (value === null) return false
  try {
    return isStoredSession(JSON.parse(value))
  } catch {
    return false
  }
}

type Client = InstanceType<typeof AuthClient>

/** A client and the storage it writes through, which closes once the app lets go of the client. */
type Held = { config: SignInConfig; client: Client; close: () => void }

type FetchInput = Parameters<typeof fetch>[0]

const urlOf = (input: FetchInput): string => {
  if (isString(input)) return input
  if (input instanceof URL) return input.href
  return input.url
}

/** Auth refused the refresh token itself, as opposed to being out of reach. */
const isRefused = (error: unknown): boolean =>
  isAuthApiError(error) || isAuthSessionMissingError(error)

const outcomeOf = (error: AuthError | null): SignInOutcomeKind =>
  signInOutcomeOf(
    error !== null && isAuthApiError(error) ? { code: error.code, status: error.status } : null,
  )

/** The task's answer, or null once `ms` have passed without one. */
const within = async <T>({
  task,
  ms,
}: {
  task: Promise<T>
  ms: number
}): Promise<{ answer: T } | null> => {
  const timer: { id: ReturnType<typeof setTimeout> | null } = { id: null }
  const late = new Promise<null>((resolve) => {
    timer.id = setTimeout(() => resolve(null), ms)
  })
  try {
    return await Promise.race([task.then((answer) => ({ answer })), late])
  } finally {
    if (timer.id !== null) clearTimeout(timer.id)
  }
}

/**
 * The server's storage, until `close`: auth-js may still be refreshing when the app signs out or
 * forgets the server, and that refresh must not write back the session just removed.
 */
const closable = (storage: SessionStorage): { storage: SessionStorage; close: () => void } => {
  const gate = { isOpen: true }
  return {
    storage: {
      getItem: (key) => (gate.isOpen ? storage.getItem(key) : Promise.resolve(null)),
      setItem: (key, value) => (gate.isOpen ? storage.setItem(key, value) : Promise.resolve()),
      removeItem: (key) => (gate.isOpen ? storage.removeItem(key) : Promise.resolve()),
    },
    close: () => {
      gate.isOpen = false
    },
  }
}

/**
 * One auth-js client per server with accounts, over that server's pinned endpoints and its own
 * keychain value. Tokens renew when asked for, so a server nobody uses costs nothing. Nothing
 * here logs: no token, password or email leaves it but the token on the server's own calls.
 */
export const createAccountSessions = ({
  store,
  fetch,
  onChange,
  deadlineMs = AUTH_DEADLINE_MS,
}: {
  store: SessionStore
  fetch: AuthFetch
  onChange: (change: SessionChange) => void
  /** How long a token read, a refresh or a sign out waits on Auth; shorter in the tests. */
  deadlineMs?: number
}): AccountSessions => {
  let clients: ReadonlyMap<string, Held> = new Map()
  let isAutoRefreshing = false

  const withinDeadline = <T>(task: Promise<T>) => within({ task, ms: deadlineMs })

  // Every write of the session passes here, so the app always knows who is signed in. A read
  // tells it nothing: each token read is one, and what listens reads the token again.
  const storageOf = (serverId: string): SessionStorage => {
    const storage = store.storageFor(serverId)
    return {
      getItem: (key) => storage.getItem(key),
      setItem: async (key, value) => {
        await storage.setItem(key, value)
        if (key === SESSION_STORAGE_KEY) onChange({ serverId, isSignedIn: isSessionValue(value) })
      },
      removeItem: async (key) => {
        await storage.removeItem(key)
        if (key === SESSION_STORAGE_KEY) onChange({ serverId, isSignedIn: false })
      },
    }
  }

  // auth-js types the option as the global fetch, whose Bun type has a `preconnect` it never calls.
  const authFetch = Object.assign(
    (input: FetchInput, init?: RequestInit) => fetch({ url: urlOf(input), init: init ?? {} }),
    { preconnect: () => undefined },
  )

  const keepFresh = ({ client, isOn }: { client: Client; isOn: boolean }): void => {
    const turn = isOn ? client.startAutoRefresh() : client.stopAutoRefresh()
    turn.catch(AUTO_REFRESH_IGNORED)
  }

  const drop = (serverId: string): void => {
    const known = clients.get(serverId)
    if (known !== undefined) {
      known.close()
      keepFresh({ client: known.client, isOn: false })
    }
    clients = new Map([...clients].filter(([id]) => id !== serverId))
  }

  const clientFor = ({ serverId, config }: { serverId: string; config: SignInConfig }): Client => {
    const known = clients.get(serverId)
    if (known !== undefined && isSameSignIn({ a: known.config, b: config })) return known.client
    // The endpoints moved: the old client's late writes would land under the same key.
    drop(serverId)
    const { storage, close } = closable(storageOf(serverId))
    const client = new AuthClient({
      url: `${config.supabaseUrl}${AUTH_V1.root}`,
      headers: { [AUTH_HEADERS.apiKey]: config.publishableKey },
      storage,
      storageKey: SESSION_STORAGE_KEY,
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      fetch: authFetch,
    })
    clients = new Map([...clients, [serverId, { config, client, close }]])
    if (isAutoRefreshing) keepFresh({ client, isOn: true })
    return client
  }

  const clientOf = (server: AccountServer): Client | null =>
    server.account === null ? null : clientFor({ serverId: server.id, config: server.account })

  const clear = async (serverId: string): Promise<void> => {
    drop(serverId)
    await store.forget(serverId)
    onChange({ serverId, isSignedIn: false })
  }

  /** The session's token, or null: none kept, Auth refused to renew it, or Auth out of reach. */
  const currentToken = async (client: Client): Promise<string | null> => {
    try {
      const read = await withinDeadline(client.getSession())
      return read?.answer.data.session?.access_token ?? null
    } catch {
      return null
    }
  }

  const signIn: AccountSessions['signIn'] = async ({ server, account, email, password }) => {
    try {
      const client = clientFor({ serverId: server.id, config: account })
      const { data, error } = await client.signInWithPassword({ email, password })
      if (error === null && data.session !== null) return SIGN_IN_OUTCOMES.signedIn
      return outcomeOf(error)
    } catch {
      return SIGN_IN_OUTCOMES.unavailable
    }
  }

  const accessToken: AccountSessions['accessToken'] = async ({ server }) => {
    const client = clientOf(server)
    return client === null ? null : currentToken(client)
  }

  const refreshed = async (client: Client): Promise<{ token: string | null; error: unknown }> => {
    try {
      const read = await withinDeadline(client.refreshSession())
      if (read === null) return { token: null, error: null }
      return { token: read.answer.data.session?.access_token ?? null, error: read.answer.error }
    } catch (error) {
      return { token: null, error }
    }
  }

  const refresh: AccountSessions['refresh'] = async ({ server }) => {
    const client = clientOf(server)
    if (client === null) return null
    const next = await refreshed(client)
    if (next.token !== null) return next.token
    // Another refresh rotated the token while this one was out; its session stands.
    if (isAuthRefreshDiscardedError(next.error)) return currentToken(client)
    if (!isRefused(next.error)) return null
    await clear(server.id)
    return null
  }

  // The desktop's scope: the sign-in ends on this device, and the account's others stand.
  const signOut: AccountSessions['signOut'] = async ({ server }) => {
    try {
      const client = clientOf(server)
      if (client !== null) await withinDeadline(client.signOut({ scope: SIGN_OUT_SCOPES.local }))
    } catch {
      // Auth out of reach: the sign-in is forgotten here all the same.
    } finally {
      await clear(server.id)
    }
  }

  const forget: AccountSessions['forget'] = ({ serverId }) => clear(serverId)

  const restore: AccountSessions['restore'] = async ({ serverIds }) => {
    await Promise.all(
      serverIds.map(async (serverId) => {
        const value = await store.storageFor(serverId).getItem(SESSION_STORAGE_KEY)
        onChange({ serverId, isSignedIn: isSessionValue(value) })
      }),
    )
  }

  const autoRefresh: AccountSessions['autoRefresh'] = ({ isOn }) => {
    isAutoRefreshing = isOn
    clients.forEach(({ client }) => keepFresh({ client, isOn }))
  }

  return { signIn, accessToken, refresh, signOut, forget, restore, autoRefresh }
}

/**
 * Renews the sessions ahead of their expiry only while the app is active, so a screen left idle
 * in the foreground never sends an expired token with a picture or the event stream, and the
 * background asks Auth nothing. Returns the way to stop.
 */
export const refreshWhileActive = ({
  sessions,
  app,
}: {
  sessions: Pick<AccountSessions, 'autoRefresh'>
  /** Whether the app is active (`AppState`'s `active`), and the way to hear when that changes. */
  app: AppActivity
}): (() => void) => {
  sessions.autoRefresh({ isOn: app.isForeground() })
  const unwatch = app.watch((isOn) => sessions.autoRefresh({ isOn }))
  return () => {
    unwatch()
    sessions.autoRefresh({ isOn: false })
  }
}

/**
 * The account's part of a server's calls: the token while `hasAccounts` says, at that call,
 * that the server signs in with accounts, a refresh after a `signed_out` refusal, and a sign out
 * when the refreshed token is refused too.
 */
export const accountBearer = ({
  sessions,
  server,
  hasAccounts,
}: {
  sessions: Pick<AccountSessions, 'accessToken' | 'refresh' | 'signOut'>
  server: AccountServer
  hasAccounts: () => boolean
}): ServerBearer => ({
  token: () => (hasAccounts() ? sessions.accessToken({ server }) : Promise.resolve(null)),
  refresh: () => sessions.refresh({ server }),
  rejected: () => sessions.signOut({ server }),
})
