import {
  APP_CALL_METHODS,
  AUTH_CONFIG_STATES,
  AUTH_HEADERS,
  AUTH_PATHS,
  type Infer,
  isAuthConfig,
  isNumber,
  isString,
  object,
} from '@raven/core'

const GRANT_TYPES = { password: 'password', refresh: 'refresh_token' } as const

const TOKEN_PATH = '/auth/v1/token'

const GRANT_PARAM = 'grant_type'

const JSON_TYPE = 'application/json'

const HEADERS = { accept: 'accept', contentType: 'content-type' } as const

const MS_PER_SECOND = 1000

const isTokenAnswer = object({
  access_token: isString,
  refresh_token: isString,
  expires_in: isNumber,
  user: object({ id: isString }),
})

const isErrorAnswer = object({ msg: isString })

export const isAccountSession = object({
  accessToken: isString,
  refreshToken: isString,
  expiresAt: isNumber,
  userId: isString,
  email: isString,
})

/** What the app keeps of a Supabase session: the two tokens, when the access one ends, and who. */
export type AccountSession = Infer<typeof isAccountSession>

export const AUTH_OUTCOMES = {
  ok: 'ok',
  refused: 'refused',
  unreachable: 'unreachable',
} as const

export type AuthOutcome =
  | { kind: typeof AUTH_OUTCOMES.ok; session: AccountSession }
  | { kind: typeof AUTH_OUTCOMES.refused; message: string }
  | { kind: typeof AUTH_OUTCOMES.unreachable }

type SupabaseConfig = { supabaseUrl: string; publishableKey: string }

type ReadSupabaseConfigProps = {
  origin: string
}

/** The raven server's public sign-in settings (the same ones the web reads), or null when it has none. */
const readSupabaseConfig = async ({
  origin,
}: ReadSupabaseConfigProps): Promise<SupabaseConfig | null> => {
  const response = await fetch(`${origin}${AUTH_PATHS.config}`, {
    headers: { [HEADERS.accept]: JSON_TYPE },
  })
  const body: unknown = await response.json()
  if (!isAuthConfig(body) || body.state !== AUTH_CONFIG_STATES.ready) return null
  return { supabaseUrl: body.supabaseUrl, publishableKey: body.publishableKey }
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
      method: APP_CALL_METHODS.post,
      headers: {
        [HEADERS.accept]: JSON_TYPE,
        [HEADERS.contentType]: JSON_TYPE,
        [AUTH_HEADERS.apiKey]: config.publishableKey,
      },
      body: JSON.stringify(body),
    })
    const answer: unknown = await response.json()
    if (response.ok && isTokenAnswer(answer)) {
      return {
        kind: AUTH_OUTCOMES.ok,
        session: {
          accessToken: answer.access_token,
          refreshToken: answer.refresh_token,
          expiresAt: Date.now() + answer.expires_in * MS_PER_SECOND,
          userId: answer.user.id,
          email,
        },
      }
    }
    // A 5xx is Supabase being down, not a refusal of this account.
    if (response.status >= 500) return { kind: AUTH_OUTCOMES.unreachable }
    return {
      kind: AUTH_OUTCOMES.refused,
      message: isErrorAnswer(answer) ? answer.msg : response.statusText,
    }
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
