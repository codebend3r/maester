import { isRecord } from '@shared/http'

/** Where rookery's server routes live: never cached, and a miss under one stays a JSON 404. */
export const ROUTE_PREFIXES = {
  api: '/api/',
  internal: '/internal/',
  auth: '/auth/',
} as const

/** rookery's server routes, as Nest registers them and as the web app and the other apps call them. */
export const ROUTES = {
  start: `${ROUTE_PREFIXES.api}auth/plex/start`,
  callback: `${ROUTE_PREFIXES.auth}plex/callback`,
  logout: `${ROUTE_PREFIXES.api}auth/logout`,
  me: `${ROUTE_PREFIXES.api}me`,
  session: `${ROUTE_PREFIXES.internal}session`,
  health: '/health',
} as const

/** Every path the server answers itself rather than handing to the web app. */
export const SERVER_PATHS: readonly string[] = [...Object.values(ROUTE_PREFIXES), ROUTES.health]

/** The web app's pages; the server sends browsers to `login` with `QUERY_PARAMS.error` set. */
export const PAGE_PATHS = { home: '/', login: '/login', logout: '/logout' } as const

/** Where to go after signing in or out, and why the server sent someone back to `/login`. The body of a write names `returnTo` too. */
export const QUERY_PARAMS = { returnTo: 'return_to', error: 'error' } as const

/** Why a sign-in came back without a session; `/login` shows a message for each. */
export const SIGN_IN_ERRORS = {
  notApproved: 'not_approved',
  expired: 'expired',
  plexUnavailable: 'plex_unavailable',
} as const

export type SignInError = (typeof SIGN_IN_ERRORS)[keyof typeof SIGN_IN_ERRORS]

/** Why a route that needs a session refused the request. */
export const SESSION_ERRORS = { signedOut: 'signed_out' } as const

/** Why a write was refused before reaching its route. */
export const WRITE_ERRORS = { jsonRequired: 'json_required' } as const

/** A user as the routes answer with them. */
export type PublicUser = {
  id: string
  display_name: string
  email: string | null
  thumb: string | null
}

/** What `ROUTES.start` answers: the Plex page the browser goes to next. */
export type StartAnswer = { auth_url: string }

/** What `ROUTES.logout` answers: where the browser goes next, already checked. */
export type LogoutAnswer = { next: string }

/** What `ROUTES.me` answers for a live session. */
export type MeAnswer = { user: PublicUser }

const isStringOrNull = (value: unknown): value is string | null =>
  value === null || typeof value === 'string'

export const isPublicUser = (value: unknown): value is PublicUser =>
  isRecord(value) &&
  typeof value.id === 'string' &&
  typeof value.display_name === 'string' &&
  isStringOrNull(value.email) &&
  isStringOrNull(value.thumb)

export const isStartAnswer = (value: unknown): value is StartAnswer =>
  isRecord(value) && typeof value.auth_url === 'string'

export const isLogoutAnswer = (value: unknown): value is LogoutAnswer =>
  isRecord(value) && typeof value.next === 'string'

export const isMeAnswer = (value: unknown): value is MeAnswer =>
  isRecord(value) && isPublicUser(value.user)
