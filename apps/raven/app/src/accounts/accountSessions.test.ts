import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { AUTH_V1, GRANTS, GRANT_PARAM, SIGN_IN_OUTCOMES } from '@raven/core'

import {
  type AccountSessions,
  SESSION_STORAGE_KEY,
  SIGN_OUT_SCOPES,
  type SessionChange,
  createAccountSessions,
  refreshWhileActive,
} from '@/accounts/accountSessions'
import { accountKeyFor, createSessionStore } from '@/accounts/sessionStore'
import type { SecretStore } from '@/servers/secretStore'
import { PIN } from '@/test/accountPins'
import { ACCOUNT, accessTokenOf, refreshTokenOf, stubAuth } from '@/test/authStub'
import { memoryStore } from '@/test/memoryStore'
import { AuthClient } from '@supabase/auth-js'

const SERVER = { id: '0f8fad5b-d9cb-469f-a165-70867728950e', account: PIN }
const OTHER = { id: '7c9e6679-7425-40de-944b-e07fc1f90ae7', account: PIN }
const UNPINNED = { id: '9b2d1c3e-4f5a-4b6c-8d7e-0f1a2b3c4d5e', account: null }
/** Short, so a refresh against an Auth out of reach, which auth-js retries, ends at once. */
const DEADLINE_MS = 50
const CONSOLE_METHODS = ['log', 'info', 'warn', 'error', 'debug'] as const
/** The query parameter auth-js names a sign out's scope in. */
const SCOPE_PARAM = 'scope'
/**
 * A token's life within auth-js's three 30 s ticks, so its next tick renews it, though past the
 * 90 s it takes as already expired, so reading the session renews nothing.
 */
const EXPIRING_SECONDS = 110
/** How long a test waits for auth-js's first tick, which it runs on the next turn of the loop. */
const TICK_WAIT_MS = 2000
const TICK_POLL_MS = 10

const setUp = ({ store = memoryStore().store }: { store?: SecretStore } = {}) => {
  const auth = stubAuth({ config: PIN })
  const changes: SessionChange[] = []
  const sessions = createAccountSessions({
    store: createSessionStore({ store }),
    fetch: auth.fetch,
    onChange: (change) => changes.push(change),
    deadlineMs: DEADLINE_MS,
  })
  const signIn = (password: string = ACCOUNT.password) =>
    sessions.signIn({ server: SERVER, account: PIN, email: ACCOUNT.email, password })
  return { auth, sessions, changes, signIn, store }
}

/** Waits until `isDone` holds, or fails once `TICK_WAIT_MS` have passed. */
const until = async (isDone: () => boolean): Promise<void> => {
  const wait = async (waited: number): Promise<void> => {
    if (isDone()) return
    if (waited >= TICK_WAIT_MS) throw new Error('Timed out')
    await new Promise((resolve) => setTimeout(resolve, TICK_POLL_MS))
    await wait(waited + TICK_POLL_MS)
  }
  await wait(0)
}

/** The paths and grants Auth was asked for, in order. */
const asked = (auth: ReturnType<typeof stubAuth>): string[] =>
  auth.state.requests.map(({ url }) => {
    const { pathname, searchParams } = new URL(url)
    const grant = searchParams.get(GRANT_PARAM)
    return grant === null ? pathname : `${pathname} ${grant}`
  })

describe('createAccountSessions', () => {
  it("signs in at the server's pinned endpoints and keeps the session in its keychain value", async () => {
    const { store, items } = memoryStore()
    const { auth, changes, signIn } = setUp({ store })
    expect(await signIn()).toBe(SIGN_IN_OUTCOMES.signedIn)
    expect(asked(auth)).toEqual([`${AUTH_V1.token} ${GRANTS.password}`])
    expect(auth.keysSent()).toEqual([PIN.publishableKey])
    const kept: unknown = JSON.parse(items.get(accountKeyFor(SERVER.id)) ?? '{}')
    expect(kept).toMatchObject({ [SESSION_STORAGE_KEY]: expect.stringContaining(accessTokenOf(1)) })
    expect(changes.at(-1)).toEqual({ serverId: SERVER.id, isSignedIn: true })
  })

  it('hands the next call the access token, with no request to Auth', async () => {
    const { auth, sessions, signIn } = setUp()
    await signIn()
    expect(await sessions.accessToken({ server: SERVER })).toBe(accessTokenOf(1))
    expect(auth.state.requests).toHaveLength(1)
  })

  it('tells the app of a session only as it is written or restored, not at each token read', async () => {
    const { sessions, changes, signIn } = setUp()
    await signIn()
    const told = changes.length
    await sessions.accessToken({ server: SERVER })
    await sessions.accessToken({ server: SERVER })
    expect(changes).toHaveLength(told)
    await sessions.refresh({ server: SERVER })
    expect(changes.slice(told)).toEqual([{ serverId: SERVER.id, isSignedIn: true }])
  })

  it('reads the session back in a new launch, without a request', async () => {
    const first = setUp()
    await first.signIn()
    const next = setUp({ store: first.store })
    await next.sessions.restore({ serverIds: [SERVER.id, OTHER.id] })
    expect(next.changes).toEqual([
      { serverId: SERVER.id, isSignedIn: true },
      { serverId: OTHER.id, isSignedIn: false },
    ])
    expect(await next.sessions.accessToken({ server: SERVER })).toBe(accessTokenOf(1))
    expect(next.auth.state.requests).toEqual([])
  })

  it('answers a wrong password as such and keeps nothing', async () => {
    const { store, items } = memoryStore()
    const { sessions, signIn } = setUp({ store })
    expect(await signIn('wrong')).toBe(SIGN_IN_OUTCOMES.wrongPassword)
    expect(await sessions.accessToken({ server: SERVER })).toBeNull()
    expect(items.size).toBe(0)
  })

  it('answers an Auth out of reach as unavailable', async () => {
    const { auth, signIn } = setUp()
    auth.state.isDown = true
    expect(await signIn()).toBe(SIGN_IN_OUTCOMES.unavailable)
  })

  it('sends no token for a server with no pinned sign-in, and asks Auth nothing', async () => {
    const { auth, sessions } = setUp()
    expect(await sessions.accessToken({ server: UNPINNED })).toBeNull()
    expect(await sessions.refresh({ server: UNPINNED })).toBeNull()
    expect(auth.state.requests).toEqual([])
  })

  it('refreshes to a new token and keeps the rotated session', async () => {
    const { auth, sessions, signIn } = setUp()
    await signIn()
    expect(await sessions.refresh({ server: SERVER })).toBe(accessTokenOf(2))
    expect(await sessions.accessToken({ server: SERVER })).toBe(accessTokenOf(2))
    expect(auth.state.live).toEqual(new Set([refreshTokenOf(2)]))
  })

  it('signs out when Auth refuses the refresh', async () => {
    const { store, items } = memoryStore()
    const { auth, sessions, changes, signIn } = setUp({ store })
    await signIn()
    auth.state.isRefreshRefused = true
    expect(await sessions.refresh({ server: SERVER })).toBeNull()
    expect(await sessions.accessToken({ server: SERVER })).toBeNull()
    expect(items.has(accountKeyFor(SERVER.id))).toBe(false)
    expect(changes.at(-1)).toEqual({ serverId: SERVER.id, isSignedIn: false })
  })

  it('keeps the session when Auth is only out of reach for the refresh', async () => {
    const { auth, sessions, signIn } = setUp()
    await signIn()
    auth.state.isDown = true
    expect(await sessions.refresh({ server: SERVER })).toBeNull()
    expect(await sessions.accessToken({ server: SERVER })).toBe(accessTokenOf(1))
  })

  it('signs out at Auth and forgets the session', async () => {
    const { store, items } = memoryStore()
    const { auth, sessions, changes, signIn } = setUp({ store })
    await signIn()
    await sessions.signOut({ server: SERVER })
    expect(asked(auth).at(-1)).toBe(AUTH_V1.logout)
    expect(await sessions.accessToken({ server: SERVER })).toBeNull()
    expect(items.size).toBe(0)
    expect(changes.at(-1)).toEqual({ serverId: SERVER.id, isSignedIn: false })
  })

  it("ends this device's sign-in alone, as the desktop does", async () => {
    const { auth, sessions, signIn } = setUp()
    await signIn()
    await sessions.signOut({ server: SERVER })
    const logout = new URL(auth.state.requests.at(-1)?.url ?? '')
    expect(logout.pathname).toBe(AUTH_V1.logout)
    expect(logout.searchParams.get(SCOPE_PARAM)).toBe(SIGN_OUT_SCOPES.local)
  })

  it('signs out at Auth in a new launch, before any token was read', async () => {
    const first = setUp()
    await first.signIn()
    const next = setUp({ store: first.store })
    await next.sessions.restore({ serverIds: [SERVER.id] })
    await next.sessions.signOut({ server: SERVER })
    expect(asked(next.auth)).toEqual([AUTH_V1.logout])
    expect(next.changes.at(-1)).toEqual({ serverId: SERVER.id, isSignedIn: false })
  })

  it('forgets the session when Auth is out of reach for the sign out', async () => {
    const { store, items } = memoryStore()
    const { auth, sessions, changes, signIn } = setUp({ store })
    await signIn()
    auth.state.isDown = true
    await sessions.signOut({ server: SERVER })
    expect(items.size).toBe(0)
    expect(changes.at(-1)).toEqual({ serverId: SERVER.id, isSignedIn: false })
  })

  it('forgets a removed server without asking Auth, and leaves the others signed in', async () => {
    const { store, items } = memoryStore()
    const { auth, sessions, changes, signIn } = setUp({ store })
    await signIn()
    await sessions.signIn({
      server: OTHER,
      account: PIN,
      email: ACCOUNT.email,
      password: ACCOUNT.password,
    })
    const before = auth.state.requests.length
    await sessions.forget({ serverId: SERVER.id })
    expect(auth.state.requests).toHaveLength(before)
    expect(await sessions.accessToken({ server: SERVER })).toBeNull()
    expect(await sessions.accessToken({ server: OTHER })).toBe(accessTokenOf(2))
    expect([...items.keys()]).toEqual([accountKeyFor(OTHER.id)])
    expect(changes).toContainEqual({ serverId: SERVER.id, isSignedIn: false })
  })

  it('reads a store that throws as signed out for the run', async () => {
    const first = setUp()
    await first.signIn()
    const throwing: SecretStore = {
      ...first.store,
      getItemAsync: async () => {
        throw new Error('A required entitlement is not present.')
      },
    }
    const next = setUp({ store: throwing })
    await next.sessions.restore({ serverIds: [SERVER.id] })
    expect(next.changes).toEqual([{ serverId: SERVER.id, isSignedIn: false }])
    expect(await next.sessions.accessToken({ server: SERVER })).toBeNull()
  })

  it('reads a kept value that is no session as signed out', async () => {
    const { store } = memoryStore([
      [accountKeyFor(SERVER.id), JSON.stringify({ [SESSION_STORAGE_KEY]: '{"user":{}}' })],
    ])
    const { sessions, changes } = setUp({ store })
    await sessions.restore({ serverIds: [SERVER.id] })
    expect(changes).toEqual([{ serverId: SERVER.id, isSignedIn: false }])
    expect(await sessions.accessToken({ server: SERVER })).toBeNull()
  })

  it('puts no password, access token or refresh token in a log line', async () => {
    const spies = CONSOLE_METHODS.map((method) =>
      spyOn(console, method).mockImplementation(() => undefined),
    )
    try {
      const { auth, sessions, signIn } = setUp()
      await signIn('wrong')
      await signIn()
      await sessions.accessToken({ server: SERVER })
      await sessions.refresh({ server: SERVER })
      auth.state.isDown = true
      await sessions.refresh({ server: SERVER })
      auth.state.isDown = false
      auth.state.isRefreshRefused = true
      await sessions.refresh({ server: SERVER })
      await signIn()
      await sessions.signOut({ server: SERVER })
      const secrets = [
        ACCOUNT.password,
        ...[1, 2, 3].flatMap((n) => [accessTokenOf(n), refreshTokenOf(n)]),
      ]
      const logged = spies.flatMap((spy) => spy.mock.calls.flat()).map(String)
      expect(logged.filter((line) => secrets.some((secret) => line.includes(secret)))).toEqual([])
    } finally {
      spies.forEach((spy) => spy.mockRestore())
    }
  })
})

describe('auto refresh', () => {
  afterEach(() => {
    mock.restore()
  })

  /** Counts each client's start and stop of auth-js's renewal timer. */
  const watchTimers = () => {
    const started = spyOn(AuthClient.prototype, 'startAutoRefresh')
    const stopped = spyOn(AuthClient.prototype, 'stopAutoRefresh')
    return { started, stopped }
  }

  it("renews a session about to run out on auth-js's own tick, with no call asking", async () => {
    const { auth, sessions, changes, signIn } = setUp()
    auth.state.expiresIn = EXPIRING_SECONDS
    await signIn()
    const told = changes.length
    sessions.autoRefresh({ isOn: true })
    await until(() => asked(auth).includes(`${AUTH_V1.token} ${GRANTS.refresh}`))
    await until(() => changes.length > told)
    sessions.autoRefresh({ isOn: false })
    expect(changes.at(-1)).toEqual({ serverId: SERVER.id, isSignedIn: true })
    expect(auth.state.live).toEqual(new Set([refreshTokenOf(2)]))
  })

  it('starts and stops every client it holds, and starts one made while it is on', async () => {
    const { started, stopped } = watchTimers()
    const { sessions, signIn } = setUp()
    await signIn()
    sessions.autoRefresh({ isOn: true })
    expect(started).toHaveBeenCalledTimes(1)
    await sessions.accessToken({ server: OTHER })
    expect(started).toHaveBeenCalledTimes(2)
    sessions.autoRefresh({ isOn: false })
    expect(stopped).toHaveBeenCalledTimes(2)
    await sessions.accessToken({ server: { ...SERVER, account: null } })
    expect(started).toHaveBeenCalledTimes(2)
  })

  it('makes no client start while it is off', async () => {
    const { started } = watchTimers()
    const { sessions, signIn } = setUp()
    await signIn()
    await sessions.accessToken({ server: OTHER })
    expect(started).not.toHaveBeenCalled()
  })

  it('stops the timer of a client it lets go of', async () => {
    const { stopped } = watchTimers()
    const { sessions, signIn } = setUp()
    await signIn()
    sessions.autoRefresh({ isOn: true })
    await sessions.forget({ serverId: SERVER.id })
    expect(stopped).toHaveBeenCalledTimes(1)
    sessions.autoRefresh({ isOn: false })
  })
})

describe('refreshWhileActive', () => {
  /** An app whose state the test turns, as `AppState` reports it. */
  const fakeApp = (isActive: boolean) => {
    const state = { isActive, listeners: new Set<(isActive: boolean) => void>() }
    return {
      state,
      app: {
        isForeground: () => state.isActive,
        watch: (onChange: (isActive: boolean) => void) => {
          state.listeners.add(onChange)
          return () => state.listeners.delete(onChange)
        },
      },
      turn: (next: boolean) => {
        state.isActive = next
        state.listeners.forEach((listener) => listener(next))
      },
    }
  }

  const recording = () => {
    const turns: boolean[] = []
    const sessions: Pick<AccountSessions, 'autoRefresh'> = {
      autoRefresh: ({ isOn }) => {
        turns.push(isOn)
      },
    }
    return { turns, sessions }
  }

  it('renews while the app is active and stops in the background', () => {
    const { turns, sessions } = recording()
    const { app, turn } = fakeApp(true)
    refreshWhileActive({ sessions, app })
    turn(false)
    turn(true)
    expect(turns).toEqual([true, false, true])
  })

  it('starts off when the app opens in the background', () => {
    const { turns, sessions } = recording()
    refreshWhileActive({ sessions, app: fakeApp(false).app })
    expect(turns).toEqual([false])
  })

  it('stops renewing and stops listening once stopped', () => {
    const { turns, sessions } = recording()
    const { app, turn, state } = fakeApp(true)
    const stop = refreshWhileActive({ sessions, app })
    stop()
    turn(true)
    expect(turns).toEqual([true, false])
    expect(state.listeners.size).toBe(0)
  })
})
