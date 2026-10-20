import { describe, expect, it } from 'bun:test'
import { AUTH_HEADERS } from '@raven/core'
import { AUTH_V1, GRANT_PARAM, GRANTS } from '@/e2e/fixtureAuth'
import {
  AUTH_ERROR_CODES,
  type AuthFetch,
  createAccountSessions,
  SESSION_STORAGE_KEY,
  SIGN_IN_OUTCOMES,
  SIGN_OUT_SCOPES,
  TICKET_MIN_VALIDITY_MS,
  TOKEN_READS,
  type TokenRead,
} from '@/main/accounts/accountSessions'
import type { SignInConfig } from '@/main/accounts/authEndpoints'
import type { SessionStorage } from '@/main/accounts/sessionStore'
import type { Timers } from '@/main/stateStore'
import { fakeTimers } from '@/main/test/playerFakes'
import { createNodeTimers } from '@/main/timers'
import { HTTP_HEADERS } from '@/shared/httpHeaders'

const SERVER = '0f4e2a4c-1b8c-4f9e-9e21-6f1f0f1d2c3a'
const USER_ID = '30000000-0000-4000-8000-000000000001'
const OTHER_USER_ID = '30000000-0000-4000-8000-000000000002'
const OTHER = '11111111-2222-4333-8444-555555555555'
const EMAIL = 'friend@maester.test'
const PASSWORD = 'correct horse battery staple'
const CONFIG: SignInConfig = {
  supabaseUrl: 'https://project.supabase.co',
  publishableKey: 'sb_publishable_example',
  webUrl: 'https://raven.example.test',
}

/** An Auth error code the sign-in does not name. */
const UNLISTED_ERROR_CODE = 'email_provider_disabled'

const SCOPE_PARAM = 'scope'
const NO_TOKEN: TokenRead = { kind: TOKEN_READS.none }

/** The token a read answered, or null when it answered none. */
const tokenOf = async (read: Promise<TokenRead>): Promise<string | null> => {
  const answer = await read
  return answer.kind === TOKEN_READS.token ? answer.token : null
}

type Reply = { status: number; body: unknown }

type Request = { url: string; init: RequestInit }

/**
 * A stand-in for Supabase Auth's token and logout endpoints. It rotates refresh tokens and
 * refuses a spent one, as the real stack does.
 */
const stubAuth = ({ expiresIn = 3600 }: { expiresIn?: number } = {}) => {
  const state: {
    expiresIn: number
    issued: number
    live: Set<string>
    requests: Request[]
    passwordReply: Reply | null
    refreshReply: Reply | null
    logoutStatus: number
    isDown: boolean
    userId: string
  } = {
    userId: USER_ID,
    expiresIn,
    issued: 0,
    live: new Set<string>(),
    requests: [],
    passwordReply: null,
    refreshReply: null,
    logoutStatus: 204,
    isDown: false,
  }

  const session = () => {
    state.issued += 1
    const refresh = `refresh-${state.issued}`
    state.live.add(refresh)
    return {
      access_token: `eyJhbGciOiJFUzI1NiJ9.eyJuIjoi${state.issued}In0.c2ln${state.issued}`,
      token_type: 'bearer',
      expires_in: state.expiresIn,
      expires_at: Math.floor(Date.now() / 1000) + state.expiresIn,
      refresh_token: refresh,
      user: {
        id: state.userId,
        aud: 'authenticated',
        email: EMAIL,
        app_metadata: {},
        user_metadata: {},
        created_at: '2026-10-18T00:00:00Z',
      },
    }
  }

  const json = ({ status, body }: Reply): Response =>
    new Response(status === 204 ? null : JSON.stringify(body), {
      status,
      headers: { [HTTP_HEADERS.contentType]: 'application/json' },
    })

  const bodyOf = (init: RequestInit): Record<string, unknown> =>
    typeof init.body === 'string' ? JSON.parse(init.body) : {}

  const fetch: AuthFetch = async ({ url, init }) => {
    state.requests.push({ url, init })
    if (state.isDown) throw new TypeError('fetch failed')
    const { pathname, searchParams } = new URL(url)
    if (pathname === AUTH_V1.token && searchParams.get(GRANT_PARAM) === GRANTS.password) {
      if (state.passwordReply !== null) return json(state.passwordReply)
      const body = bodyOf(init)
      if (body.email !== EMAIL || body.password !== PASSWORD) {
        return json({
          status: 400,
          body: {
            error_code: AUTH_ERROR_CODES.invalidCredentials,
            msg: 'Invalid login credentials',
          },
        })
      }
      return json({ status: 200, body: session() })
    }
    if (pathname === AUTH_V1.token && searchParams.get(GRANT_PARAM) === GRANTS.refresh) {
      if (state.refreshReply !== null) return json(state.refreshReply)
      const token = bodyOf(init).refresh_token
      if (typeof token !== 'string' || !state.live.has(token)) {
        return json({
          status: 400,
          body: { error_code: AUTH_ERROR_CODES.refreshTokenNotFound, msg: 'Invalid Refresh Token' },
        })
      }
      state.live.delete(token)
      return json({ status: 200, body: session() })
    }
    if (pathname === AUTH_V1.logout) {
      return json({ status: state.logoutStatus, body: { msg: 'logout failed' } })
    }
    return json({ status: 404, body: { msg: 'not found' } })
  }

  const grants = () =>
    state.requests
      .map(({ url }) => new URL(url).searchParams.get(GRANT_PARAM))
      .filter((grant) => grant !== null)

  return { state, fetch, grants }
}

/** auth-js storage over a plain map per server, like the session store in memory. */
const memoryStorage = () => {
  const servers = new Map<string, Map<string, string>>()
  const itemsOf = (serverId: string): Map<string, string> => {
    const known = servers.get(serverId)
    if (known !== undefined) return known
    const made = new Map<string, string>()
    servers.set(serverId, made)
    return made
  }
  const storageFor = (serverId: string): SessionStorage => ({
    getItem: async (key) => itemsOf(serverId).get(key) ?? null,
    setItem: async (key, value) => {
      itemsOf(serverId).set(key, value)
    },
    removeItem: async (key) => {
      itemsOf(serverId).delete(key)
    },
  })
  return { storageFor, itemsOf }
}

/**
 * Deadlines that pass after a few real milliseconds, for an Auth that is out of reach:
 * auth-js would otherwise retry its refresh for 30 s.
 */
const quickDeadlines = (): Timers => {
  const node = createNodeTimers()
  return { set: ({ run }) => node.set({ run, ms: 50 }), clear: node.clear }
}

const sessionsWith = ({
  auth,
  storage = memoryStorage(),
  config = () => CONFIG,
  timers = fakeTimers().timers,
  warnings = [],
  ended = [],
}: {
  auth: ReturnType<typeof stubAuth>
  storage?: ReturnType<typeof memoryStorage>
  config?: (serverId: string) => SignInConfig | null
  timers?: Timers
  warnings?: string[]
  ended?: string[]
}) =>
  createAccountSessions({
    storageFor: storage.storageFor,
    configOf: config,
    fetch: auth.fetch,
    now: Date.now,
    timers,
    onEnded: (serverId) => {
      ended.push(serverId)
    },
    warn: (message) => {
      warnings.push(message)
    },
  })

describe('signIn', () => {
  it('signs in through the server pinned endpoints and keeps the session in its storage', async () => {
    const auth = stubAuth()
    const storage = memoryStorage()
    const sessions = sessionsWith({ auth, storage })
    expect(
      await sessions.signIn({ serverId: SERVER, email: EMAIL, password: PASSWORD, config: CONFIG }),
    ).toEqual({
      kind: SIGN_IN_OUTCOMES.signedIn,
    })
    const [request] = auth.state.requests
    expect(request?.url ?? null).toBe(
      `${CONFIG.supabaseUrl}${AUTH_V1.token}?${GRANT_PARAM}=${GRANTS.password}`,
    )
    expect(new Headers(request?.init.headers ?? {}).get(AUTH_HEADERS.apiKey)).toBe(
      CONFIG.publishableKey,
    )
    expect(storage.itemsOf(SERVER).get(SESSION_STORAGE_KEY)).toContain('refresh-1')
    expect(storage.itemsOf(OTHER).size).toBe(0)
  })

  it('sends the password to the endpoints it is given, not to the ones the server kept', async () => {
    const auth = stubAuth()
    const kept: SignInConfig = {
      supabaseUrl: 'https://old.supabase.co',
      publishableKey: 'sb_publishable_old',
      webUrl: 'https://raven.example.test',
    }
    const sessions = sessionsWith({ auth, config: () => kept })
    await sessions.signIn({ serverId: SERVER, email: EMAIL, password: PASSWORD, config: CONFIG })
    expect(auth.state.requests.map((request) => new URL(request.url).origin)).toEqual([
      'https://project.supabase.co',
    ])
    expect(new Headers(auth.state.requests[0]?.init.headers ?? {}).get(AUTH_HEADERS.apiKey)).toBe(
      CONFIG.publishableKey,
    )
  })

  it('signs in even when the server kept no endpoints yet', async () => {
    const auth = stubAuth()
    const sessions = sessionsWith({ auth, config: () => null })
    expect(
      await sessions.signIn({ serverId: SERVER, email: EMAIL, password: PASSWORD, config: CONFIG }),
    ).toEqual({ kind: SIGN_IN_OUTCOMES.signedIn })
  })

  it('a new instance over the same storage restores the session without a request', async () => {
    const auth = stubAuth()
    const storage = memoryStorage()
    await sessionsWith({ auth, storage }).signIn({
      serverId: SERVER,
      email: EMAIL,
      password: PASSWORD,
      config: CONFIG,
    })
    const before = auth.state.requests.length
    const token = await tokenOf(sessionsWith({ auth, storage }).accessToken({ serverId: SERVER }))
    expect(token).toStartWith('eyJ')
    expect(auth.state.requests).toHaveLength(before)
  })

  it.each([
    [
      { status: 400, body: { error_code: AUTH_ERROR_CODES.invalidCredentials, msg: 'no' } },
      SIGN_IN_OUTCOMES.wrongPassword,
    ],
    [
      { status: 400, body: { error_code: AUTH_ERROR_CODES.emailNotConfirmed, msg: 'no' } },
      SIGN_IN_OUTCOMES.unconfirmed,
    ],
    [
      {
        status: 429,
        body: { error_code: AUTH_ERROR_CODES.overRequestRateLimit, msg: 'slow down' },
      },
      SIGN_IN_OUTCOMES.rateLimited,
    ],
    [{ status: 500, body: { msg: 'boom' } }, SIGN_IN_OUTCOMES.unavailable],
    [{ status: 503, body: { msg: 'down' } }, SIGN_IN_OUTCOMES.unavailable],
    [
      { status: 400, body: { error_code: UNLISTED_ERROR_CODE, msg: 'no' } },
      SIGN_IN_OUTCOMES.unavailable,
    ],
  ])('maps %o to %s', async (reply, kind) => {
    const auth = stubAuth()
    auth.state.passwordReply = reply
    const sessions = sessionsWith({ auth })
    expect(
      await sessions.signIn({ serverId: SERVER, email: EMAIL, password: PASSWORD, config: CONFIG }),
    ).toEqual({
      kind,
    })
    expect(await sessions.accessToken({ serverId: SERVER })).toEqual(NO_TOKEN)
  })

  it('a wrong password is its own outcome', async () => {
    const sessions = sessionsWith({ auth: stubAuth() })
    expect(
      await sessions.signIn({ serverId: SERVER, email: EMAIL, password: 'nope', config: CONFIG }),
    ).toEqual({
      kind: SIGN_IN_OUTCOMES.wrongPassword,
    })
  })

  it('a network failure is unavailable', async () => {
    const auth = stubAuth()
    auth.state.isDown = true
    const sessions = sessionsWith({ auth })
    expect(
      await sessions.signIn({ serverId: SERVER, email: EMAIL, password: PASSWORD, config: CONFIG }),
    ).toEqual({
      kind: SIGN_IN_OUTCOMES.unavailable,
    })
  })

  it('builds a new client when the pinned endpoints change', async () => {
    const auth = stubAuth()
    const pins: { current: SignInConfig } = { current: CONFIG }
    const sessions = sessionsWith({ auth, config: () => pins.current })
    await sessions.signIn({ serverId: SERVER, email: EMAIL, password: PASSWORD, config: CONFIG })
    pins.current = { ...CONFIG, supabaseUrl: 'https://moved.supabase.co' }
    await sessions.signIn({
      serverId: SERVER,
      email: EMAIL,
      password: PASSWORD,
      config: pins.current,
    })
    expect(auth.state.requests.map(({ url }) => new URL(url).origin)).toEqual([
      'https://project.supabase.co',
      'https://moved.supabase.co',
    ])
  })
})

describe('accessToken', () => {
  it('answers no token for a server never signed in', async () => {
    expect(await sessionsWith({ auth: stubAuth() }).accessToken({ serverId: SERVER })).toEqual(
      NO_TOKEN,
    )
  })

  it('says Auth is out of reach, not signed out, when a token near its end cannot be renewed', async () => {
    const auth = stubAuth({ expiresIn: 60 })
    const sessions = sessionsWith({ auth, timers: quickDeadlines() })
    await sessions.signIn({ serverId: SERVER, email: EMAIL, password: PASSWORD, config: CONFIG })
    auth.state.isDown = true
    expect(await sessions.accessToken({ serverId: SERVER })).toEqual({
      kind: TOKEN_READS.unreachable,
    })
  })

  it('says Auth is out of reach when a token that ran out cannot be renewed', async () => {
    const auth = stubAuth({ expiresIn: -10 })
    const storage = memoryStorage()
    const sessions = sessionsWith({ auth, storage, timers: quickDeadlines() })
    await sessions.signIn({ serverId: SERVER, email: EMAIL, password: PASSWORD, config: CONFIG })
    auth.state.isDown = true
    expect(
      await sessions.accessToken({ serverId: SERVER, minValidityMs: TICKET_MIN_VALIDITY_MS }),
    ).toEqual({ kind: TOKEN_READS.unreachable })
    expect(storage.itemsOf(SERVER).size).toBeGreaterThan(0)
  })

  it('answers no token when Auth refuses to renew one that ran out, and ends its access once', async () => {
    const auth = stubAuth({ expiresIn: -10 })
    const ended: string[] = []
    const sessions = sessionsWith({ auth, ended })
    await sessions.signIn({ serverId: SERVER, email: EMAIL, password: PASSWORD, config: CONFIG })
    auth.state.live.clear()
    expect(await sessions.accessToken({ serverId: SERVER })).toEqual(NO_TOKEN)
    expect(await sessions.accessToken({ serverId: SERVER })).toEqual(NO_TOKEN)
    expect(ended).toEqual([SERVER])
  })

  it('ends no access for a server never signed in', async () => {
    const ended: string[] = []
    await sessionsWith({ auth: stubAuth(), ended }).accessToken({ serverId: SERVER })
    expect(ended).toEqual([])
  })

  it('answers the stored token while it has long to live', async () => {
    const auth = stubAuth()
    const sessions = sessionsWith({ auth })
    await sessions.signIn({ serverId: SERVER, email: EMAIL, password: PASSWORD, config: CONFIG })
    const first = await tokenOf(sessions.accessToken({ serverId: SERVER }))
    expect(await tokenOf(sessions.accessToken({ serverId: SERVER }))).toBe(first)
    expect(
      await tokenOf(
        sessions.accessToken({ serverId: SERVER, minValidityMs: TICKET_MIN_VALIDITY_MS }),
      ),
    ).toBe(first)
    expect(auth.grants()).toEqual([GRANTS.password])
  })

  it('refreshes and rotates near expiry', async () => {
    const auth = stubAuth({ expiresIn: 60 })
    const sessions = sessionsWith({ auth })
    await sessions.signIn({ serverId: SERVER, email: EMAIL, password: PASSWORD, config: CONFIG })
    const token = await tokenOf(sessions.accessToken({ serverId: SERVER }))
    expect(token).toContain('c2ln2')
    expect(auth.grants()).toEqual([GRANTS.password, GRANTS.refresh])
    expect(auth.state.live.has('refresh-1')).toBe(false)
    expect(auth.state.live.has('refresh-2')).toBe(true)
  })

  it('minValidityMs refreshes earlier than auth-js would', async () => {
    const auth = stubAuth({ expiresIn: 300 })
    const sessions = sessionsWith({ auth })
    await sessions.signIn({ serverId: SERVER, email: EMAIL, password: PASSWORD, config: CONFIG })
    expect(await tokenOf(sessions.accessToken({ serverId: SERVER }))).toContain('c2ln1')
    auth.state.expiresIn = 3600
    expect(
      await tokenOf(
        sessions.accessToken({ serverId: SERVER, minValidityMs: TICKET_MIN_VALIDITY_MS }),
      ),
    ).toContain('c2ln2')
    expect(auth.grants()).toEqual([GRANTS.password, GRANTS.refresh])
  })

  it('keeps a still valid token when the early refresh cannot reach Auth', async () => {
    const auth = stubAuth({ expiresIn: 300 })
    const sessions = sessionsWith({ auth, timers: quickDeadlines() })
    await sessions.signIn({ serverId: SERVER, email: EMAIL, password: PASSWORD, config: CONFIG })
    auth.state.isDown = true
    expect(
      await tokenOf(
        sessions.accessToken({ serverId: SERVER, minValidityMs: TICKET_MIN_VALIDITY_MS }),
      ),
    ).toContain('c2ln1')
  })
})

describe('refresh', () => {
  it('forces one refresh and answers the new token', async () => {
    const auth = stubAuth()
    const sessions = sessionsWith({ auth })
    await sessions.signIn({ serverId: SERVER, email: EMAIL, password: PASSWORD, config: CONFIG })
    expect(await sessions.refresh(SERVER)).toContain('c2ln2')
    expect(auth.grants()).toEqual([GRANTS.password, GRANTS.refresh])
  })

  it('a rejected refresh token signs the server out locally and ends its access', async () => {
    const auth = stubAuth()
    const storage = memoryStorage()
    const ended: string[] = []
    const sessions = sessionsWith({ auth, storage, ended })
    await sessions.signIn({ serverId: SERVER, email: EMAIL, password: PASSWORD, config: CONFIG })
    auth.state.live.clear()
    expect(await sessions.refresh(SERVER)).toBeNull()
    expect(await sessions.accessToken({ serverId: SERVER })).toEqual(NO_TOKEN)
    expect(storage.itemsOf(SERVER).size).toBe(0)
    expect(ended).toEqual([SERVER])
  })

  it('an Auth outage keeps the session for a later try, and its access', async () => {
    const auth = stubAuth()
    const ended: string[] = []
    const sessions = sessionsWith({ auth, timers: quickDeadlines(), ended })
    await sessions.signIn({ serverId: SERVER, email: EMAIL, password: PASSWORD, config: CONFIG })
    auth.state.refreshReply = { status: 503, body: { msg: 'down' } }
    expect(await sessions.refresh(SERVER)).toBeNull()
    expect(await tokenOf(sessions.accessToken({ serverId: SERVER }))).toContain('c2ln1')
    expect(ended).toEqual([])
  })

  it('is null for a server never signed in', async () => {
    expect(await sessionsWith({ auth: stubAuth() }).refresh(SERVER)).toBeNull()
  })
})

describe('signOut and forget', () => {
  it('signs out at Auth and clears the storage', async () => {
    const auth = stubAuth()
    const storage = memoryStorage()
    const sessions = sessionsWith({ auth, storage })
    await sessions.signIn({ serverId: SERVER, email: EMAIL, password: PASSWORD, config: CONFIG })
    await sessions.signOut(SERVER)
    const logout = auth.state.requests.at(-1)
    expect(logout?.url ?? null).toBe(
      `${CONFIG.supabaseUrl}${AUTH_V1.logout}?${SCOPE_PARAM}=${SIGN_OUT_SCOPES.local}`,
    )
    expect(storage.itemsOf(SERVER).size).toBe(0)
    expect(await sessions.accessToken({ serverId: SERVER })).toEqual(NO_TOKEN)
  })

  it('clears the storage even when logout answers 500 or Auth is down', async () => {
    const auth = stubAuth()
    const storage = memoryStorage()
    const sessions = sessionsWith({ auth, storage })
    await sessions.signIn({ serverId: SERVER, email: EMAIL, password: PASSWORD, config: CONFIG })
    auth.state.logoutStatus = 500
    await sessions.signOut(SERVER)
    expect(storage.itemsOf(SERVER).size).toBe(0)

    await sessions.signIn({ serverId: SERVER, email: EMAIL, password: PASSWORD, config: CONFIG })
    auth.state.isDown = true
    await sessions.signOut(SERVER)
    expect(storage.itemsOf(SERVER).size).toBe(0)
  })

  it('clears the storage of a server whose endpoints are no longer pinned', async () => {
    const auth = stubAuth()
    const storage = memoryStorage()
    const pins: { current: SignInConfig | null } = { current: CONFIG }
    const sessions = sessionsWith({ auth, storage, config: () => pins.current })
    await sessions.signIn({ serverId: SERVER, email: EMAIL, password: PASSWORD, config: CONFIG })
    pins.current = null
    await sessions.signOut(SERVER)
    expect(storage.itemsOf(SERVER).size).toBe(0)
  })

  it('a refresh that answers after forget never writes the session back', async () => {
    const auth = stubAuth()
    const memory = memoryStorage()
    const race: { isArmed: boolean; forgetting: Promise<void> | null } = {
      isArmed: false,
      forgetting: null,
    }
    // auth-js reads its slot again once the refresh answers, to see whether it changed. The
    // forget lands just after that read and before auth-js writes the rotated session.
    const storage = {
      ...memory,
      storageFor: (serverId: string): SessionStorage => {
        const inner = memory.storageFor(serverId)
        return {
          ...inner,
          getItem: async (key) => {
            const value = await inner.getItem(key)
            if (race.isArmed && key === SESSION_STORAGE_KEY) {
              race.isArmed = false
              race.forgetting = sessions.forget(SERVER)
            }
            return value
          },
        }
      },
    }
    const racing: AuthFetch = async (input) => {
      const reply = await auth.fetch(input)
      if (new URL(input.url).searchParams.get(GRANT_PARAM) === GRANTS.refresh) race.isArmed = true
      return reply
    }
    const sessions = sessionsWith({ auth: { ...auth, fetch: racing }, storage })
    await sessions.signIn({ serverId: SERVER, email: EMAIL, password: PASSWORD, config: CONFIG })
    await sessions.refresh(SERVER)
    await race.forgetting
    expect(race.forgetting).not.toBeNull()
    expect(memory.itemsOf(SERVER).size).toBe(0)
  })

  it('forget drops the session without a request', async () => {
    const auth = stubAuth()
    const storage = memoryStorage()
    const sessions = sessionsWith({ auth, storage })
    await sessions.signIn({ serverId: SERVER, email: EMAIL, password: PASSWORD, config: CONFIG })
    const before = auth.state.requests.length
    await sessions.forget(SERVER)
    expect(auth.state.requests).toHaveLength(before)
    expect(storage.itemsOf(SERVER).size).toBe(0)
    expect(await sessions.accessToken({ serverId: SERVER })).toEqual(NO_TOKEN)
  })
})

describe('accountIdOf', () => {
  it('names the account signed in, and the account of each new sign in', async () => {
    const auth = stubAuth()
    const sessions = sessionsWith({ auth })
    expect(sessions.accountIdOf({ serverId: SERVER })).toBeNull()
    await sessions.signIn({ serverId: SERVER, email: EMAIL, password: PASSWORD, config: CONFIG })
    expect(sessions.accountIdOf({ serverId: SERVER })).toBe(USER_ID)
    expect(sessions.accountIdOf({ serverId: OTHER })).toBeNull()
    auth.state.userId = OTHER_USER_ID
    await sessions.signIn({ serverId: SERVER, email: EMAIL, password: PASSWORD, config: CONFIG })
    expect(sessions.accountIdOf({ serverId: SERVER })).toBe(OTHER_USER_ID)
  })

  it('reads a relaunch its stored sessions without a request', async () => {
    const auth = stubAuth()
    const storage = memoryStorage()
    await sessionsWith({ auth, storage }).signIn({
      serverId: SERVER,
      email: EMAIL,
      password: PASSWORD,
      config: CONFIG,
    })
    const before = auth.state.requests.length
    const relaunched = sessionsWith({ auth, storage })
    await relaunched.restore({ serverIds: [SERVER, OTHER] })
    expect(relaunched.accountIdOf({ serverId: SERVER })).toBe(USER_ID)
    expect(relaunched.accountIdOf({ serverId: OTHER })).toBeNull()
    expect(auth.state.requests).toHaveLength(before)
  })

  it('names no account once signed out, forgotten or refused a refresh', async () => {
    const auth = stubAuth()
    const sessions = sessionsWith({ auth })
    const signIn = () =>
      sessions.signIn({ serverId: SERVER, email: EMAIL, password: PASSWORD, config: CONFIG })
    await signIn()
    await sessions.signOut(SERVER)
    expect(sessions.accountIdOf({ serverId: SERVER })).toBeNull()
    await signIn()
    await sessions.forget(SERVER)
    expect(sessions.accountIdOf({ serverId: SERVER })).toBeNull()
    await signIn()
    auth.state.live.clear()
    await sessions.refresh(SERVER)
    expect(sessions.accountIdOf({ serverId: SERVER })).toBeNull()
  })
})

describe('warnings', () => {
  it('never hold a token, a password or an email', async () => {
    const auth = stubAuth({ expiresIn: 60 })
    const warnings: string[] = []
    const sessions = sessionsWith({ auth, warnings, timers: quickDeadlines() })
    await sessions.signIn({ serverId: SERVER, email: EMAIL, password: PASSWORD, config: CONFIG })
    auth.state.isDown = true
    await sessions.signIn({ serverId: SERVER, email: EMAIL, password: PASSWORD, config: CONFIG })
    await sessions.accessToken({ serverId: SERVER })
    auth.state.isDown = false
    auth.state.live.clear()
    await sessions.refresh(SERVER)
    auth.state.logoutStatus = 500
    await sessions.signOut(SERVER)
    expect(warnings.length).toBeGreaterThan(0)
    const text = warnings.join('\n')
    expect(text).not.toContain('eyJ')
    expect(text).not.toContain('refresh-')
    expect(text).not.toContain(PASSWORD)
    expect(text).not.toContain(EMAIL)
    expect(text).not.toContain(CONFIG.publishableKey)
  })
})
