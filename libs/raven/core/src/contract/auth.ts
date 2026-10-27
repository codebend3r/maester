import { HTTP_METHODS } from '@/contract/http'
import { type Infer, isBoolean, isString, listOf, matching, object, oneOf, union } from '@/schema'

export const MEMBER_STATUSES = {
  pending: 'pending',
  approved: 'approved',
  revoked: 'revoked',
} as const
export const isMemberStatus = oneOf(Object.values(MEMBER_STATUSES))

export const AUTH_CONFIG_STATES = {
  off: 'off',
  unavailable: 'unavailable',
  ready: 'ready',
} as const
export const AUTH_COOKIE = 'maester-auth'
/** The cookies raven's server sets, each `Path=/api; HttpOnly; SameSite=Strict`: the PIN's, naming the account that entered it, and the admin lock's. */
export const SERVER_COOKIES = { unlock: 'raven_unlock', admin: 'raven_admin' } as const
export const UNLOCK_COOKIE_PATH = '/api'
export const AUTH_HEADERS = {
  authorization: 'authorization',
  cookie: 'cookie',
  apiKey: 'apikey',
} as const
export const AUTH_SCHEME = 'Bearer'
export const AUTH_API_PREFIX = '/api/'
export const AUTH_METHODS = {
  get: HTTP_METHODS.get,
  head: HTTP_METHODS.head,
  post: HTTP_METHODS.post,
} as const
/**
 * The query key a media ticket travels in, on the file and sidecar URLs,
 * and an HLS session's capability on the URIs its playlists name.
 */
export const MEDIA_TICKET_PARAM = 't'
export const AUTH_PARAMS = { id: 'id', pageSize: 'pageSize', pageOffset: 'pageOffset' } as const
export const AUTH_PATHS = {
  config: '/api/auth/config',
  me: '/api/me',
  members: '/api/auth/members',
  memberStatus: '/api/auth/members/:id/status',
  ticket: '/api/auth/media/:id/ticket',
} as const
export const AUTH_ROUTES = {
  signIn: '/sign-in',
  signUp: '/sign-up',
  checkEmail: '/check-email',
  confirm: '/auth/confirm',
  forgot: '/forgot-password',
  reset: '/reset-password',
  pending: '/pending',
} as const

export const isAccountId = matching(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
)

export const isAuthConfig = union(
  object({ state: oneOf([AUTH_CONFIG_STATES.off, AUTH_CONFIG_STATES.unavailable]) }),
  object({
    state: oneOf([AUTH_CONFIG_STATES.ready]),
    supabaseUrl: isString,
    publishableKey: isString,
    webUrl: isString,
    cookieName: oneOf([AUTH_COOKIE]),
  }),
)
export type AuthConfig = Infer<typeof isAuthConfig>

export const isAccount = object({
  id: isAccountId,
  email: isString,
  status: isMemberStatus,
  isOwner: isBoolean,
})
export type Account = Infer<typeof isAccount>
export const isAccountList = listOf(isAccount)
export const isMemberStatusChange = object({
  status: oneOf([MEMBER_STATUSES.approved, MEMBER_STATUSES.revoked]),
})
export type MemberStatusChange = Infer<typeof isMemberStatusChange>

export const AUTH_REFUSALS = {
  signedOut: 'signed_out',
  pending: 'pending',
  revoked: 'revoked',
  notOwner: 'not_owner',
  unavailable: 'unavailable',
} as const
export const isAuthRefusal = object({
  reason: oneOf(Object.values(AUTH_REFUSALS)),
  message: isString,
})
export type AuthRefusal = Infer<typeof isAuthRefusal>
