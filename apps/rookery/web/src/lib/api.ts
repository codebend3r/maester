import {
  type PublicUser,
  QUERY_PARAMS,
  ROUTES,
  SIGN_IN_ERRORS,
  isLogoutAnswer,
  isMeAnswer,
  isStartAnswer,
} from '@rookery/core'
import { CONTENT_TYPES, HEADERS, HTTP_METHODS, HTTP_STATUSES } from '@shared/http'

/*
 * rookery's own API, on the same origin in every setup: Docker serves this
 * app from the server, and in development Vite proxies to it. Writes are
 * JSON, which the server requires.
 */

/**
 * Why a sign-in or sign-out could not go ahead; the login page has a message
 * for each. The server's `/login?error=` codes, plus `unreachable` for
 * rookery itself not answering.
 */
export const AUTH_ERRORS = { ...SIGN_IN_ERRORS, unreachable: 'unreachable' } as const

export type AuthErrorCode = (typeof AUTH_ERRORS)[keyof typeof AUTH_ERRORS]

export const isAuthErrorCode = (value: unknown): value is AuthErrorCode =>
  Object.values(AUTH_ERRORS).some((code) => code === value)

type AuthFailure = typeof AUTH_ERRORS.plexUnavailable | typeof AUTH_ERRORS.unreachable

export class AuthError extends Error {
  constructor(readonly code: AuthFailure) {
    super(code)
  }
}

type PostJsonProps = { url: string; body: Record<string, string> }

type JsonAnswer = { status: number; isOk: boolean; body: unknown }

const postJson = async ({ url, body }: PostJsonProps): Promise<JsonAnswer> => {
  const response = await fetch(url, {
    method: HTTP_METHODS.post,
    headers: { [HEADERS.contentType]: CONTENT_TYPES.json },
    body: JSON.stringify(body),
  })
  const parsed: unknown = await response.json().catch(() => null)
  return { status: response.status, isOk: response.ok, body: parsed }
}

const withReturnTo = (returnTo: string | null): Record<string, string> =>
  returnTo ? { [QUERY_PARAMS.returnTo]: returnTo } : {}

type StartSignInProps = { returnTo: string | null }

/** Starts a Plex sign-in; resolves to the Plex page the browser goes to next. */
export const startSignIn = async ({ returnTo }: StartSignInProps): Promise<string> => {
  const response = await postJson({ url: ROUTES.start, body: withReturnTo(returnTo) }).catch(
    () => null,
  )
  if (response == null) throw new AuthError(AUTH_ERRORS.unreachable)
  if (response.status === HTTP_STATUSES.unavailable) {
    throw new AuthError(AUTH_ERRORS.plexUnavailable)
  }
  if (!response.isOk || !isStartAnswer(response.body)) throw new AuthError(AUTH_ERRORS.unreachable)
  return response.body.auth_url
}

type SignOutProps = { returnTo: string | null }

/** Ends the session; resolves to where the browser goes next, which the server has checked. */
export const signOut = async ({ returnTo }: SignOutProps): Promise<string> => {
  const response = await postJson({ url: ROUTES.logout, body: withReturnTo(returnTo) })
  if (!response.isOk || !isLogoutAnswer(response.body)) throw new AuthError(AUTH_ERRORS.unreachable)
  return response.body.next
}

/** The signed-in user, or null when there is no session. */
export const fetchMe = async (): Promise<PublicUser | null> => {
  const response = await fetch(ROUTES.me)
  if (response.status === HTTP_STATUSES.unauthorized) return null
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok || !isMeAnswer(body)) throw new AuthError(AUTH_ERRORS.unreachable)
  return body.user
}
