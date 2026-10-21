import {
  AUTH_ERROR_CODES,
  AUTH_HEADERS,
  AUTH_V1,
  GRANTS,
  GRANT_PARAM,
  type SignInConfig,
  isRecord,
  isString,
} from '@raven/core'

import type { AuthFetch } from '@/accounts/accountSessions'

/** The account the stub signs in. */
export const ACCOUNT = {
  id: '30000000-0000-4000-8000-000000000001',
  email: 'friend@maester.test',
  password: 'correct horse battery staple',
} as const

const LOGOUT_STATUS = 204
const OK_STATUS = 200
const REFUSED_STATUS = 400
const MISSING_STATUS = 404
/** A token's life, as Supabase Auth's default. */
const TOKEN_SECONDS = 3600

type Reply = { status: number; body: unknown }

/** A request the stub heard, for what a test checks it was sent. */
type AuthRequest = { url: string; init: RequestInit }

/** The access token the stub hands out `n`th, shaped as a JWT. */
export const accessTokenOf = (n: number): string => `eyJhbGciOiJFUzI1NiJ9.eyJuIjoi${n}In0.c2ln${n}`

/** The refresh token the stub hands out `n`th. */
export const refreshTokenOf = (n: number): string => `refresh-${n}`

const fieldsOf = (init: RequestInit): Record<string, unknown> => {
  const parsed: unknown = isString(init.body) ? JSON.parse(init.body) : {}
  return isRecord(parsed) ? parsed : {}
}

/**
 * A stand-in for Supabase Auth's token and logout endpoints at `config`'s address. It hands out
 * numbered tokens, rotates refresh tokens and refuses a spent one, as the real stack does.
 */
export const stubAuth = ({ config }: { config: SignInConfig }) => {
  const state: {
    issued: number
    live: Set<string>
    requests: AuthRequest[]
    isDown: boolean
    isRefreshRefused: boolean
    /** How long each token it hands out lasts, in seconds. */
    expiresIn: number
  } = {
    issued: 0,
    live: new Set(),
    requests: [],
    isDown: false,
    isRefreshRefused: false,
    expiresIn: TOKEN_SECONDS,
  }

  const session = () => {
    state.issued += 1
    const refresh = refreshTokenOf(state.issued)
    state.live.add(refresh)
    return {
      access_token: accessTokenOf(state.issued),
      token_type: 'bearer',
      expires_in: state.expiresIn,
      expires_at: Math.floor(Date.now() / 1000) + state.expiresIn,
      refresh_token: refresh,
      user: {
        id: ACCOUNT.id,
        aud: 'authenticated',
        email: ACCOUNT.email,
        app_metadata: {},
        user_metadata: {},
        created_at: '2026-10-18T00:00:00Z',
      },
    }
  }

  const json = ({ status, body }: Reply): Response =>
    new Response(status === LOGOUT_STATUS ? null : JSON.stringify(body), { status })

  const refused = (code: string): Response =>
    json({ status: REFUSED_STATUS, body: { error_code: code, msg: 'refused' } })

  const answer = ({ url, init }: { url: URL; init: RequestInit }): Response => {
    const grant = url.searchParams.get(GRANT_PARAM)
    const fields = fieldsOf(init)
    if (url.pathname === AUTH_V1.token && grant === GRANTS.password) {
      const isRight = fields.email === ACCOUNT.email && fields.password === ACCOUNT.password
      return isRight
        ? json({ status: OK_STATUS, body: session() })
        : refused(AUTH_ERROR_CODES.invalidCredentials)
    }
    if (url.pathname === AUTH_V1.token && grant === GRANTS.refresh) {
      const token = fields.refresh_token
      if (state.isRefreshRefused || !isString(token) || !state.live.has(token)) {
        return refused(AUTH_ERROR_CODES.refreshTokenNotFound)
      }
      state.live.delete(token)
      return json({ status: OK_STATUS, body: session() })
    }
    if (url.pathname === AUTH_V1.logout) return json({ status: LOGOUT_STATUS, body: null })
    return json({ status: MISSING_STATUS, body: { msg: 'not found' } })
  }

  const fetch: AuthFetch = async ({ url: address, init }) => {
    state.requests.push({ url: address, init })
    if (state.isDown) throw new TypeError('Network request failed')
    const url = new URL(address)
    if (url.origin !== config.supabaseUrl) return json({ status: MISSING_STATUS, body: null })
    return answer({ url, init })
  }

  /** The publishable key each request to Auth carried. */
  const keysSent = (): (string | null)[] =>
    state.requests.map(({ init }) => new Headers(init.headers).get(AUTH_HEADERS.apiKey))

  return { state, fetch, keysSent }
}
