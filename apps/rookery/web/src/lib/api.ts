/**
 * rookery's own API, on the same origin in every setup: Docker serves this
 * app from the server, and in development Vite proxies to it. Writes are
 * JSON, which the server requires.
 */

export type User = {
  id: string
  display_name: string
  email: string | null
  thumb: string | null
}

/** Why a sign-in or sign-out could not go ahead; the login page has a message for each. */
export class AuthError extends Error {
  constructor(readonly code: 'plex_unavailable' | 'unreachable') {
    super(code)
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value != null && !Array.isArray(value)

const isUser = (value: unknown): value is User =>
  isRecord(value) && typeof value.id === 'string' && typeof value.display_name === 'string'

const postJson = async ({ url, body }: { url: string; body: Record<string, string> }) => {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const parsed: unknown = await response.json().catch(() => null)
  return { status: response.status, ok: response.ok, body: parsed }
}

const withReturnTo = (returnTo: string | null): Record<string, string> =>
  returnTo ? { return_to: returnTo } : {}

/** Starts a Plex sign-in; resolves to the Plex page the browser goes to next. */
export const startSignIn = async ({ returnTo }: { returnTo: string | null }): Promise<string> => {
  const response = await postJson({
    url: '/api/auth/plex/start',
    body: withReturnTo(returnTo),
  }).catch(() => null)
  if (response == null) throw new AuthError('unreachable')
  if (response.status === 503) throw new AuthError('plex_unavailable')
  const authUrl = isRecord(response.body) ? response.body.auth_url : null
  if (!response.ok || typeof authUrl !== 'string') throw new AuthError('unreachable')
  return authUrl
}

/** Ends the session; resolves to where the browser goes next, which the server has checked. */
export const signOut = async ({ returnTo }: { returnTo: string | null }): Promise<string> => {
  const response = await postJson({ url: '/api/auth/logout', body: withReturnTo(returnTo) })
  const next = isRecord(response.body) ? response.body.next : null
  if (!response.ok || typeof next !== 'string') throw new AuthError('unreachable')
  return next
}

/** The signed-in user, or null when there is no session. */
export const fetchMe = async (): Promise<User | null> => {
  const response = await fetch('/api/me')
  if (response.status === 401) return null
  const body: unknown = await response.json().catch(() => null)
  const user = isRecord(body) ? body.user : null
  if (!response.ok || !isUser(user)) throw new AuthError('unreachable')
  return user
}
