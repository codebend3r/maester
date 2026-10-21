import { AUTH_ROUTES, type AuthRefusal, isAuthRefusal } from '@/contract'
import { type Infer, oneOf } from '@/schema'

/** Supabase Auth's paths under a project's address, which every client signs in through. */
export const AUTH_V1 = {
  root: '/auth/v1',
  token: '/auth/v1/token',
  logout: '/auth/v1/logout',
} as const

/** The query key naming a token request's grant, and the grants a client asks for. */
export const GRANT_PARAM = 'grant_type'
export const GRANTS = { password: 'password', refresh: 'refresh_token' } as const

/** The server pages Create account and Forgot password open, on the server's web origin. */
export const ACCOUNT_PAGES = { signUp: 'signUp', forgot: 'forgot' } as const

export const isAccountPage = oneOf(Object.values(ACCOUNT_PAGES))

export type AccountPage = Infer<typeof isAccountPage>

const routeFor = (page: AccountPage): string => {
  switch (page) {
    case ACCOUNT_PAGES.signUp:
      return AUTH_ROUTES.signUp
    case ACCOUNT_PAGES.forgot:
      return AUTH_ROUTES.forgot
    default: {
      const unreachable: never = page
      return unreachable
    }
  }
}

/** Where `page` lives on `webUrl`, the web origin a server's sign-in is pinned with. */
export const accountPageUrl = ({ webUrl, page }: { webUrl: string; page: AccountPage }): string =>
  `${webUrl}${routeFor(page)}`

export const SIGN_IN_OUTCOMES = {
  signedIn: 'signedIn',
  wrongPassword: 'wrongPassword',
  unconfirmed: 'unconfirmed',
  rateLimited: 'rateLimited',
  unavailable: 'unavailable',
} as const

export type SignInOutcomeKind = (typeof SIGN_IN_OUTCOMES)[keyof typeof SIGN_IN_OUTCOMES]

/** The Supabase Auth error codes a sign-in tells apart. */
export const AUTH_ERROR_CODES = {
  invalidCredentials: 'invalid_credentials',
  refreshTokenNotFound: 'refresh_token_not_found',
  validationFailed: 'validation_failed',
  emailNotConfirmed: 'email_not_confirmed',
  overRequestRateLimit: 'over_request_rate_limit',
} as const

const TOO_MANY_REQUESTS_STATUS = 429

/**
 * What a password sign-in's refusal means, from the code and status of the error Auth answered
 * with; `null` is no answer from Auth at all, which is an outage like any unknown code.
 */
export const signInOutcomeOf = (
  error: { code: string | undefined; status: number } | null,
): SignInOutcomeKind => {
  if (error === null) return SIGN_IN_OUTCOMES.unavailable
  switch (error.code) {
    case AUTH_ERROR_CODES.invalidCredentials:
    case AUTH_ERROR_CODES.validationFailed:
      return SIGN_IN_OUTCOMES.wrongPassword
    case AUTH_ERROR_CODES.emailNotConfirmed:
      return SIGN_IN_OUTCOMES.unconfirmed
    case AUTH_ERROR_CODES.overRequestRateLimit:
      return SIGN_IN_OUTCOMES.rateLimited
    default:
      return error.status === TOO_MANY_REQUESTS_STATUS
        ? SIGN_IN_OUTCOMES.rateLimited
        : SIGN_IN_OUTCOMES.unavailable
  }
}

/** What every client's sign-in form says, word for word. */
export const SIGN_IN_MESSAGES = {
  wrongPassword: 'Email or password is wrong.',
  unconfirmed: 'Confirm your email first. The link is in your inbox.',
  rateLimited: 'Wait a moment before trying again.',
  notOpen: 'That server is not taking sign ins right now.',
} as const

/** Said when the sign-in could not be reached or answered, naming the server the person chose. */
export const signInUnavailable = ({ name }: { name: string }): string =>
  `${name} could not sign you in right now. Try again.`

/** What a sign-in that did not sign in says, for the server named `name`. */
export const signInMessageOf = ({
  kind,
  name,
}: {
  kind: SignInOutcomeKind
  name: string
}): string => {
  switch (kind) {
    case SIGN_IN_OUTCOMES.wrongPassword:
      return SIGN_IN_MESSAGES.wrongPassword
    case SIGN_IN_OUTCOMES.unconfirmed:
      return SIGN_IN_MESSAGES.unconfirmed
    case SIGN_IN_OUTCOMES.rateLimited:
      return SIGN_IN_MESSAGES.rateLimited
    case SIGN_IN_OUTCOMES.unavailable:
    case SIGN_IN_OUTCOMES.signedIn:
      return signInUnavailable({ name })
    default: {
      const unreachable: never = kind
      return unreachable
    }
  }
}

/** The reason a refused answer's body gives, or null when the body is no auth refusal. */
export const authRefusalIn = (body: string): AuthRefusal['reason'] | null => {
  try {
    const parsed: unknown = JSON.parse(body)
    return isAuthRefusal(parsed) ? parsed.reason : null
  } catch {
    return null
  }
}

/** The reason a reply gives when its status is one of `statuses`; null for any other reply. */
export const refusalAt = ({
  status,
  body,
  statuses,
}: {
  status: number
  body: string
  statuses: readonly number[]
}): AuthRefusal['reason'] | null => (statuses.includes(status) ? authRefusalIn(body) : null)
