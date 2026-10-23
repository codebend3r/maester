import { randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  type Account,
  AUTH_CONFIG_STATES,
  AUTH_COOKIE,
  AUTH_HEADERS,
  AUTH_PARAMS,
  AUTH_PATHS,
  AUTH_REFUSALS,
  AUTH_SCHEME,
  type AuthConfig,
  type AuthRefusal,
  MEDIA_TICKET_PARAM,
  MEMBER_STATUSES,
  PAGE_ORIGIN,
  SERVER_METHODS,
} from '@raven/core'
import {
  allowCrossOrigin,
  fieldOf,
  partsOf,
  PREFLIGHT_METHOD,
  sendEmpty,
  sendJson,
  sendMissing,
  tokenOf,
} from '@/e2e/fixtureHttp'

/** The `error_code` Supabase Auth answers a refused sign in or refresh with. */
const AUTH_ERROR_CODES = {
  invalidCredentials: 'invalid_credentials',
  refreshTokenNotFound: 'refresh_token_not_found',
} as const

export const FIXTURE_ACCOUNT_KINDS = { off: 'off', legacy: 'legacy', ready: 'ready' } as const

/**
 * The accounts as this server has them:
 * - `off`: a server with accounts off, answering `{ state: 'off' }` to `/api/auth/config`.
 * - `legacy`: a server older than the config route, answering 404 to it.
 * - `ready`: accounts on. The fixture's own origin is the Supabase URL and the web URL, a stub
 *   Auth sits at `/auth/v1`, and `FIXTURE_ACCOUNT` signs in as `status`. Its tickets live
 *   `ticketMs`, or until the JWT that asked for them ends, which is `jwtSeconds` after sign-in.
 */
export type FixtureAccounts =
  | { kind: typeof FIXTURE_ACCOUNT_KINDS.off }
  | { kind: typeof FIXTURE_ACCOUNT_KINDS.legacy }
  | {
      kind: typeof FIXTURE_ACCOUNT_KINDS.ready
      status: Account['status']
      ticketMs: number
      jwtSeconds: number
    }

/** The one account a `ready` fixture signs in. */
export const FIXTURE_ACCOUNT = {
  id: '30000000-0000-4000-8000-000000000001',
  email: 'friend@maester.test',
  password: 'correct horse battery staple',
} as const

export const FIXTURE_PUBLISHABLE_KEY = 'sb_publishable_fixture'

export const ACCOUNT_TICKET_PREFIX = 'account.'
/** Every route under this prefix is the stub Auth's, whose bodies hold passwords and refresh tokens. */
export const AUTH_V1_PREFIX = '/auth/v1/'
export const AUTH_V1 = {
  token: `${AUTH_V1_PREFIX}token`,
  logout: `${AUTH_V1_PREFIX}logout`,
} as const
export const GRANT_PARAM = 'grant_type'
export const GRANTS = { password: 'password', refresh: 'refresh_token' } as const
const AUTH_FIELDS = {
  email: 'email',
  password: 'password',
  refreshToken: 'refresh_token',
} as const
const JWT_TYPE = 'JWT'
/** As the server's `AccountTickets` caps them. */
const MAX_TICKETS = 2048
export const MAX_ACCOUNT_TICKETS = 32
const MS_PER_SECOND = 1000
// What Supabase Auth names in a session and its JWT.
const SESSION_NAMES = {
  audience: 'authenticated',
  tokenType: 'bearer',
  algorithm: 'ES256',
} as const

/** A title's account ticket: valid for that title alone, until `expiresAt` in epoch milliseconds. */
type AccountTicket = { mediaId: number; expiresAt: number }
/** What a refused account request answers, in the shape `isAuthRefusal` accepts. */
type Refusal = { status: number; reason: AuthRefusal['reason']; message: string }

/** The status and message of each refusal, as the server's `authFailure` words them. */
const REFUSALS = {
  [AUTH_REFUSALS.signedOut]: { status: 401, message: 'Sign in to continue.' },
  [AUTH_REFUSALS.pending]: { status: 403, message: 'Your account is awaiting approval.' },
  [AUTH_REFUSALS.revoked]: { status: 403, message: 'Your access has been removed.' },
  [AUTH_REFUSALS.notOwner]: { status: 403, message: 'Only the owner can manage accounts.' },
  [AUTH_REFUSALS.unavailable]: {
    status: 503,
    message: 'Account access is temporarily unavailable.',
  },
} as const satisfies Record<AuthRefusal['reason'], { status: number; message: string }>

const refusalFor = (reason: AuthRefusal['reason']): Refusal => ({ reason, ...REFUSALS[reason] })

const SIGNED_OUT = refusalFor(AUTH_REFUSALS.signedOut)

/** The refusal a status stands for, or null when it is approved. */
const refusalOfStatus = (member: Account['status']): Refusal | null => {
  switch (member) {
    case MEMBER_STATUSES.approved:
      return null
    case MEMBER_STATUSES.pending:
      return refusalFor(AUTH_REFUSALS.pending)
    case MEMBER_STATUSES.revoked:
      return refusalFor(AUTH_REFUSALS.revoked)
    default: {
      const unreachable: never = member
      return unreachable
    }
  }
}

/** The bearer token a request carries, or null. */
export const bearerOf = (request: IncomingMessage): string | null => {
  const header = request.headers[AUTH_HEADERS.authorization] ?? ''
  const prefix = `${AUTH_SCHEME} `
  return header.startsWith(prefix) ? header.slice(prefix.length) : null
}

/** The account ticket a request's query carries in `t`, or null. */
const accountTicketOf = (request: IncomingMessage): string | null => {
  const ticket = partsOf(request.url ?? '').query.get(MEDIA_TICKET_PARAM)
  return (ticket?.startsWith(ACCOUNT_TICKET_PREFIX) ?? false) ? ticket : null
}

/** The path of the ticket route for one title, as the server's `AUTH_PATHS.ticket` names it. */
const ticketRouteOf = (pathname: string): number | null => {
  const [head = '', tail = ''] = AUTH_PATHS.ticket.split(`:${AUTH_PARAMS.id}`)
  if (!pathname.startsWith(head) || !pathname.endsWith(tail)) return null
  const id = pathname.slice(head.length, pathname.length - tail.length)
  return /^\d+$/u.test(id) ? Number(id) : null
}

const base64urlJson = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')

const sendRefusal = ({ response, refusal }: { response: ServerResponse; refusal: Refusal }) =>
  sendJson({
    response,
    status: refusal.status,
    body: { reason: refusal.reason, message: refusal.message },
  })

/** What an account ticket on a media plane request came to: none presented, passed, or refused and answered. */
export const TICKET_CHECKS = { none: 'none', passed: 'passed', refused: 'refused' } as const

type TicketCheck = (typeof TICKET_CHECKS)[keyof typeof TICKET_CHECKS]

/**
 * The fixture's accounts: the config route, a stub Supabase Auth at `/auth/v1` that signs in
 * `FIXTURE_ACCOUNT`, `/api/me`, and the account tickets, minted and redeemed as the server does.
 */
export const createFixtureAuth = ({
  accounts,
  origin,
  now,
  hasTitle,
  isHeldBack,
}: {
  accounts: FixtureAccounts
  /** The fixture's own origin, which a `ready` config names as its Supabase and web URL. */
  origin: () => string
  now: () => number
  hasTitle: (mediaId: number) => boolean
  /** Answers for a title in the locked library this browser may not see; false when it may. */
  isHeldBack: (input: {
    request: IncomingMessage
    response: ServerResponse
    missing: string
  }) => boolean
}) => {
  let issuedTokens: readonly string[] = []
  let status: Account['status'] =
    accounts.kind === FIXTURE_ACCOUNT_KINDS.ready ? accounts.status : MEMBER_STATUSES.approved
  // Refresh token to the access token of its session; a rotation or a sign-out removes it.
  let refreshes: ReadonlyMap<string, string> = new Map()
  // Access token to the epoch milliseconds its JWT ends.
  let accessEnds: ReadonlyMap<string, number> = new Map()
  let accountTickets: ReadonlyMap<string, AccountTicket> = new Map()

  /** Whether a Bearer token is one this server signed in and that has not ended. */
  const isLive = (token: string | null): token is string => {
    if (token === null) return false
    const end = accessEnds.get(token)
    return end !== undefined && now() < end
  }

  /** As the media plane does: the ticket is this title's and unexpired, then the account is checked again. */
  const redeem = ({ ticket, mediaId }: { ticket: string; mediaId: number }): Refusal | null => {
    const held = accountTickets.get(ticket)
    if (held === undefined || held.mediaId !== mediaId || now() >= held.expiresAt) return SIGNED_OUT
    return refusalOfStatus(status)
  }

  const startSession = (): unknown => {
    if (accounts.kind !== FIXTURE_ACCOUNT_KINDS.ready) return null
    const endMs = now() + accounts.jwtSeconds * MS_PER_SECOND
    const access = [
      base64urlJson({ alg: SESSION_NAMES.algorithm, typ: JWT_TYPE }),
      base64urlJson({
        sub: FIXTURE_ACCOUNT.id,
        aud: SESSION_NAMES.audience,
        exp: Math.floor(endMs / MS_PER_SECOND),
        jti: tokenOf(),
      }),
      randomBytes(16).toString('base64url'),
    ].join('.')
    const refresh = randomBytes(12).toString('base64url')
    accessEnds = new Map([...accessEnds, [access, endMs]])
    refreshes = new Map([...refreshes, [refresh, access]])
    issuedTokens = [...issuedTokens, access, refresh]
    return {
      access_token: access,
      token_type: SESSION_NAMES.tokenType,
      expires_in: accounts.jwtSeconds,
      expires_at: Math.floor(endMs / MS_PER_SECOND),
      refresh_token: refresh,
      user: {
        id: FIXTURE_ACCOUNT.id,
        aud: SESSION_NAMES.audience,
        email: FIXTURE_ACCOUNT.email,
        app_metadata: {},
        user_metadata: {},
        created_at: '2026-10-18T00:00:00Z',
      },
    }
  }

  const answerToken = ({
    response,
    query,
    body,
  }: {
    response: ServerResponse
    query: URLSearchParams
    body: string | null
  }) => {
    const grant = query.get(GRANT_PARAM)
    if (grant === GRANTS.password) {
      const isRight =
        fieldOf({ body, name: AUTH_FIELDS.email }) === FIXTURE_ACCOUNT.email &&
        fieldOf({ body, name: AUTH_FIELDS.password }) === FIXTURE_ACCOUNT.password
      if (!isRight) {
        return sendJson({
          response,
          status: 400,
          body: {
            error_code: AUTH_ERROR_CODES.invalidCredentials,
            msg: 'Invalid login credentials',
          },
        })
      }
      return sendJson({ response, status: 200, body: startSession() })
    }
    if (grant === GRANTS.refresh) {
      const token = fieldOf({ body, name: AUTH_FIELDS.refreshToken }) ?? ''
      if (!refreshes.has(token)) {
        return sendJson({
          response,
          status: 400,
          body: { error_code: AUTH_ERROR_CODES.refreshTokenNotFound, msg: 'Invalid Refresh Token' },
        })
      }
      refreshes = new Map([...refreshes].filter(([spent]) => spent !== token))
      return sendJson({ response, status: 200, body: startSession() })
    }
    return sendMissing(response)
  }

  const answerLogout = ({
    request,
    response,
  }: {
    request: IncomingMessage
    response: ServerResponse
  }) => {
    const token = bearerOf(request)
    refreshes = new Map([...refreshes].filter(([, access]) => access !== token))
    sendEmpty({ response, status: 204 })
  }

  const answerTicketMint = ({
    request,
    response,
    mediaId,
  }: {
    request: IncomingMessage
    response: ServerResponse
    mediaId: number
  }) => {
    const token = bearerOf(request)
    if (accounts.kind !== FIXTURE_ACCOUNT_KINDS.ready) {
      return sendRefusal({ response, refusal: refusalFor(AUTH_REFUSALS.unavailable) })
    }
    if (!isLive(token)) return sendRefusal({ response, refusal: SIGNED_OUT })
    const refusal = refusalOfStatus(status)
    if (refusal !== null) return sendRefusal({ response, refusal })
    if (!hasTitle(mediaId)) {
      return sendJson({ response, status: 404, body: { message: `No media ${mediaId}` } })
    }
    if (isHeldBack({ request, response, missing: `No media ${mediaId}` })) return
    const expiresAt = Math.min(now() + accounts.ticketMs, accessEnds.get(token) ?? 0)
    if (expiresAt <= now()) return sendRefusal({ response, refusal: SIGNED_OUT })
    accountTickets = new Map([...accountTickets].filter(([, held]) => held.expiresAt > now()))
    // The fixture has the one account, so its live tickets are all of them.
    const live = accountTickets.size
    if (live >= MAX_TICKETS || live >= MAX_ACCOUNT_TICKETS) {
      return sendRefusal({ response, refusal: refusalFor(AUTH_REFUSALS.unavailable) })
    }
    const ticket = `${ACCOUNT_TICKET_PREFIX}${randomBytes(24).toString('base64url')}`
    accountTickets = new Map([...accountTickets, [ticket, { mediaId, expiresAt }]])
    issuedTokens = [...issuedTokens, ticket]
    sendJson({ response, status: 200, body: { ticket, expiresAt } })
  }

  /** What the config route answers; null for a server too old to have the route. */
  const authConfig = (): AuthConfig | null => {
    switch (accounts.kind) {
      case FIXTURE_ACCOUNT_KINDS.ready:
        return {
          state: AUTH_CONFIG_STATES.ready,
          supabaseUrl: origin(),
          publishableKey: FIXTURE_PUBLISHABLE_KEY,
          webUrl: origin(),
          cookieName: AUTH_COOKIE,
        }
      case FIXTURE_ACCOUNT_KINDS.off:
        return { state: AUTH_CONFIG_STATES.off }
      case FIXTURE_ACCOUNT_KINDS.legacy:
        return null
      default: {
        const unreachable: never = accounts
        return unreachable
      }
    }
  }

  /**
   * The routes accounts add, which the pre-accounts server did not have: the config, the stub
   * Auth, the account and the ticket. False for a request they do not answer.
   */
  const answerAccounts = ({
    request,
    response,
    body,
  }: {
    request: IncomingMessage
    response: ServerResponse
    body: string | null
  }): boolean => {
    const { pathname, query } = partsOf(request.url ?? '')
    const method = request.method ?? ''
    const config = authConfig()
    if (method === SERVER_METHODS.get && pathname === AUTH_PATHS.config && config !== null) {
      sendJson({ response, status: 200, body: config })
      return true
    }
    if (accounts.kind !== FIXTURE_ACCOUNT_KINDS.ready) {
      const mintId = method === SERVER_METHODS.post ? ticketRouteOf(pathname) : null
      if (mintId === null) return false
      answerTicketMint({ request, response, mediaId: mintId })
      return true
    }
    // Raven's page signs in here from its own origin, as it does at Supabase.
    if (pathname.startsWith(AUTH_V1_PREFIX)) allowCrossOrigin({ response, origin: PAGE_ORIGIN })
    if (method === PREFLIGHT_METHOD && pathname.startsWith(AUTH_V1_PREFIX)) {
      sendEmpty({ response, status: 204 })
      return true
    }
    if (method === SERVER_METHODS.post && pathname === AUTH_V1.token) {
      answerToken({ response, query, body })
      return true
    }
    if (method === SERVER_METHODS.post && pathname === AUTH_V1.logout) {
      answerLogout({ request, response })
      return true
    }
    if (method === SERVER_METHODS.get && pathname === AUTH_PATHS.me) {
      const token = bearerOf(request)
      if (!isLive(token)) {
        sendRefusal({ response, refusal: SIGNED_OUT })
        return true
      }
      const account: Account = {
        id: FIXTURE_ACCOUNT.id,
        email: FIXTURE_ACCOUNT.email,
        status,
        isOwner: false,
      }
      sendJson({ response, status: 200, body: account })
      return true
    }
    const mediaId = method === SERVER_METHODS.post ? ticketRouteOf(pathname) : null
    if (mediaId === null) return false
    answerTicketMint({ request, response, mediaId })
    return true
  }

  /** An account ticket on a media plane request, redeemed as the server's media plane does. */
  const checkTicket = ({
    request,
    response,
    mediaId,
  }: {
    request: IncomingMessage
    response: ServerResponse
    mediaId: number
  }): TicketCheck => {
    const presented =
      accounts.kind === FIXTURE_ACCOUNT_KINDS.ready ? accountTicketOf(request) : null
    if (presented === null) return TICKET_CHECKS.none
    const refusal = redeem({ ticket: presented, mediaId })
    if (refusal === null) return TICKET_CHECKS.passed
    sendRefusal({ response, refusal })
    return TICKET_CHECKS.refused
  }

  return {
    answerAccounts,
    checkTicket,
    issuedTokens: () => issuedTokens,
    setStatus: (next: Account['status']) => {
      if (accounts.kind !== FIXTURE_ACCOUNT_KINDS.ready) {
        throw new Error('The fixture has no account whose status could change')
      }
      status = next
    },
  }
}
