import {
  HTTP_METHODS,
  AUTH_CONFIG_STATES,
  AUTH_HEADERS,
  AUTH_PATHS,
  type Infer,
  isAuthConfig,
  isNumber,
  isString,
  object,
  optional,
} from '@raven/core'
import { CONTENT_TYPES, HEADERS } from '@shared/http'

const GRANT_TYPES = { password: 'password', refresh: 'refresh_token' } as const

const TOKEN_PATH = '/auth/v1/token'

const GRANT_PARAM = 'grant_type'

const MS_PER_SECOND = 1000

const isTokenAnswer = object({
  access_token: isString,
  refresh_token: isString,
  expires_in: isNumber,
  user: object({ id: isString }),
})

// Supabase Auth's refusal: its words, and the code naming what was refused.
const isErrorAnswer = object({ msg: isString, error_code: optional(isString) })

export const isAccountSession = object({
  accessToken: isString,
  refreshToken: isString,
  expiresAt: isNumber,
  userId: isString,
  email: isString,
})

/** What the app keeps of a Supabase session: the two tokens, when the access one ends, and who. */
export type AccountSession = Infer<typeof isAccountSession>

type AccountSessionOfProps = Omit<AccountSession, 'expiresAt'> & {
  /** How long the access token lasts, in seconds, as Supabase Auth says it. */
  expiresIn: number
  now: number
}

/** A session Supabase Auth made, as this device keeps one: its access token dated from `now`. */
export const accountSessionOf = ({
  accessToken,
  refreshToken,
  expiresIn,
  userId,
  email,
  now,
}: AccountSessionOfProps): AccountSession => ({
  accessToken,
  refreshToken,
  expiresAt: now + expiresIn * MS_PER_SECOND,
  userId,
  email,
})

export const AUTH_OUTCOMES = {
  ok: 'ok',
  refused: 'refused',
  unreachable: 'unreachable',
} as const

export type AuthOutcome =
  | { kind: typeof AUTH_OUTCOMES.ok; session: AccountSession }
  | { kind: typeof AUTH_OUTCOMES.refused; message: string; code: string | null }
  | { kind: typeof AUTH_OUTCOMES.unreachable }

export type SupabaseConfig = { supabaseUrl: string; publishableKey: string; webUrl: string }

type ReadSupabaseConfigProps = {
  origin: string
}

/** The raven server's public sign-in settings (the same ones the web reads), or null when it has none. */
export const readSupabaseConfig = async ({
  origin,
}: ReadSupabaseConfigProps): Promise<SupabaseConfig | null> => {
  const response = await fetch(`${origin}${AUTH_PATHS.config}`, {
    headers: { [HEADERS.accept]: CONTENT_TYPES.json },
  })
  const body: unknown = await response.json()
  if (!isAuthConfig(body) || body.state !== AUTH_CONFIG_STATES.ready) return null
  return {
    supabaseUrl: body.supabaseUrl,
    publishableKey: body.publishableKey,
    webUrl: body.webUrl,
  }
}

type RequestTokenProps = {
  origin: string
  grant: (typeof GRANT_TYPES)[keyof typeof GRANT_TYPES]
  body: Record<string, string>
  email: string
}

const requestToken = async ({
  origin,
  grant,
  body,
  email,
}: RequestTokenProps): Promise<AuthOutcome> => {
  try {
    const config = await readSupabaseConfig({ origin })
    if (config === null) return { kind: AUTH_OUTCOMES.unreachable }
    const response = await fetch(`${config.supabaseUrl}${TOKEN_PATH}?${GRANT_PARAM}=${grant}`, {
      method: HTTP_METHODS.post,
      headers: {
        [HEADERS.accept]: CONTENT_TYPES.json,
        [HEADERS.contentType]: CONTENT_TYPES.json,
        [AUTH_HEADERS.apiKey]: config.publishableKey,
      },
      body: JSON.stringify(body),
    })
    const answer: unknown = await response.json()
    if (response.ok && isTokenAnswer(answer)) {
      return {
        kind: AUTH_OUTCOMES.ok,
        session: accountSessionOf({
          accessToken: answer.access_token,
          refreshToken: answer.refresh_token,
          expiresIn: answer.expires_in,
          userId: answer.user.id,
          email,
          now: Date.now(),
        }),
      }
    }
    // A 5xx is Supabase being down, not a refusal of this account.
    if (response.status >= 500) return { kind: AUTH_OUTCOMES.unreachable }
    if (!isErrorAnswer(answer)) {
      return { kind: AUTH_OUTCOMES.refused, message: response.statusText, code: null }
    }
    return { kind: AUTH_OUTCOMES.refused, message: answer.msg, code: answer.error_code ?? null }
  } catch {
    return { kind: AUTH_OUTCOMES.unreachable }
  }
}

type SignInWithPasswordProps = {
  origin: string
  email: string
  password: string
}

export const signInWithPassword = ({
  origin,
  email,
  password,
}: SignInWithPasswordProps): Promise<AuthOutcome> =>
  requestToken({ origin, grant: GRANT_TYPES.password, body: { email, password }, email })

type RefreshSessionProps = {
  origin: string
  session: AccountSession
}

export const refreshSession = ({ origin, session }: RefreshSessionProps): Promise<AuthOutcome> =>
  requestToken({
    origin,
    grant: GRANT_TYPES.refresh,
    body: { refresh_token: session.refreshToken },
    email: session.email,
  })
