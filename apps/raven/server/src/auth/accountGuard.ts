import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  SetMetadata,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import {
  AUTH_CONFIG_STATES,
  AUTH_HEADERS,
  AUTH_REFUSALS,
  type Account,
  type AuthConfig,
  HLS_PARAMS,
  isHlsSessionId,
  isString,
  MEDIA_TICKET_PARAM,
} from '@raven/core'
import { CACHE_POLICIES, HEADERS } from '@shared/server'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { AUDIENCES, audienceOf } from '@/admin/adminGuard'
import { accessTokenOf } from '@/auth/accessToken'
import { ACCOUNT_TICKET_PREFIX, AccountTickets } from '@/auth/accountTickets'
import { authFailure } from '@/auth/authFailure'
import { AuthSessions, requireApproved } from '@/auth/authSessions'
import { AUTH_STATE } from '@/auth/effectiveAuth'
import { isCapabilityRoute, isHlsCapability } from '@/hls/hlsCapability'
import { HlsSessions, noSuchSession } from '@/hls/hlsSessions'
import { isMediaPlaneRoute } from '@/media/mediaPlaneMark'
import { ROUTE_PARAMS, requestParts } from '@/requestParts'
import type { MarkTargets } from '@/routeMarks'

const ACCOUNT_ACCESS = Symbol('ACCOUNT_ACCESS')

/** What a route asks of the caller once accounts are `ready`. */
export const ACCOUNT_REQUIREMENTS = {
  anyone: 'anyone',
  session: 'session',
  approved: 'approved',
  owner: 'owner',
} as const

export type AccountRequirement = (typeof ACCOUNT_REQUIREMENTS)[keyof typeof ACCOUNT_REQUIREMENTS]

type GatedRequirement = Exclude<AccountRequirement, typeof ACCOUNT_REQUIREMENTS.anyone>

const isAccountRequirement = (value: unknown): value is AccountRequirement =>
  Object.values(ACCOUNT_REQUIREMENTS).some((requirement) => requirement === value)

export const RequireAccount = (requirement: AccountRequirement) =>
  SetMetadata(ACCOUNT_ACCESS, requirement)

/**
 * Marks a route that answers everyone in every auth state, with no account
 * asked for. Not the lock's `Public()`, which says a route's parameter
 * names nothing the PIN holds back.
 */
export const OpenToAnyone = () => RequireAccount(ACCOUNT_REQUIREMENTS.anyone)

const decorators = new Reflector()

/**
 * What a route asks of an account: its own `RequireAccount` mark, else its
 * controller's; failing both, the owner for `@AdminOnly()` and an approved
 * account for everything else, so a route nobody marked is never open.
 */
export const accountRuleOf = (
  targets: MarkTargets,
): { requirement: AccountRequirement; isExplicit: boolean } => {
  const marked: unknown = decorators.getAllAndOverride(ACCOUNT_ACCESS, targets)
  if (isAccountRequirement(marked)) return { requirement: marked, isExplicit: true }
  return {
    requirement:
      audienceOf(targets) === AUDIENCES.admin
        ? ACCOUNT_REQUIREMENTS.owner
        : ACCOUNT_REQUIREMENTS.approved,
    isExplicit: false,
  }
}

const AUTH_VARY = [AUTH_HEADERS.authorization, AUTH_HEADERS.cookie] as const

/** `existing` Vary with the account headers added, keeping what CORS and others put there. */
const varyByAccount = (existing: string | number | string[] | undefined): string => {
  const names = (Array.isArray(existing) ? existing : [String(existing ?? '')])
    .flatMap((value) => value.split(','))
    .map((name) => name.trim())
    .filter((name) => name !== '')
  const missing = AUTH_VARY.filter((header) => !names.some((name) => name.toLowerCase() === header))
  return [...names, ...missing].join(', ')
}

const isMediaIdParam = (value: unknown): value is string =>
  isString(value) && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value))

/** An account ticket in `?t=` on a media plane route, or null; a legacy ticket is never one. */
const accountTicketOf = ({
  query,
  targets,
}: {
  query: Record<string, unknown>
  targets: MarkTargets
}): string | null => {
  if (!isMediaPlaneRoute(targets)) return null
  const ticket = query[MEDIA_TICKET_PARAM]
  return isString(ticket) && ticket.startsWith(ACCOUNT_TICKET_PREFIX) ? ticket : null
}

/** An HLS session's capability in `?t=` on a route that names the session, or null. */
const capabilityOf = ({
  query,
  targets,
}: {
  query: Record<string, unknown>
  targets: MarkTargets
}): string | null => {
  if (!isCapabilityRoute(targets)) return null
  const capability = query[MEDIA_TICKET_PARAM]
  return isHlsCapability(capability) ? capability : null
}

const admit = ({
  requirement,
  account,
}: {
  requirement: GatedRequirement
  account: Account
}): void => {
  switch (requirement) {
    case ACCOUNT_REQUIREMENTS.session:
      return
    case ACCOUNT_REQUIREMENTS.approved:
      requireApproved(account)
      return
    case ACCOUNT_REQUIREMENTS.owner:
      requireApproved(account)
      if (!account.isOwner) throw authFailure(AUTH_REFUSALS.notOwner)
      return
    default: {
      const unreachable: never = requirement
      throw new Error(`Unknown account requirement: ${String(unreachable)}`)
    }
  }
}

/**
 * The account gate, default-deny. Open routes pass in every state. With
 * accounts `off`, a route that asks for an account by its own mark is
 * refused as unavailable and the rest pass for the legacy browser, as before
 * accounts. `unavailable` refuses everything but the open routes. `ready`
 * resolves the caller from Bearer, from the session cookie on a GET or
 * HEAD, from an account ticket on the media plane, or from an HLS
 * session's capability on that session's routes, and holds it to the
 * route's requirement.
 */
@Injectable()
export class AccountGuard implements CanActivate {
  constructor(
    @Inject(AuthSessions) private readonly sessions: AuthSessions,
    @Inject(AccountTickets) private readonly tickets: AccountTickets,
    @Inject(AUTH_STATE) private readonly auth: AuthConfig,
    @Inject(HlsSessions) private readonly hls: Pick<HlsSessions, 'grantOf'>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()]
    const { requirement, isExplicit } = accountRuleOf(targets)
    if (requirement === ACCOUNT_REQUIREMENTS.anyone) return true
    const { params, query } = requestParts(context)
    const ticket = accountTicketOf({ query, targets })
    if (this.auth.state === AUTH_CONFIG_STATES.off && !isExplicit && ticket === null) return true
    const http = context.switchToHttp()
    const reply = http.getResponse<FastifyReply>()
    // A handler that sets its own private policy, as pictures and files do, overrides no-store.
    reply
      .header(HEADERS.cacheControl, CACHE_POLICIES.noStore)
      .header(HEADERS.vary, varyByAccount(reply.getHeader(HEADERS.vary)))
    if (this.auth.state === AUTH_CONFIG_STATES.unavailable) {
      throw authFailure(AUTH_REFUSALS.unavailable)
    }
    const request = http.getRequest<FastifyRequest>()
    if (ticket !== null) {
      await this.admitTicket({ request, ticket, id: params[ROUTE_PARAMS.id], requirement })
      return true
    }
    if (this.auth.state !== AUTH_CONFIG_STATES.ready) throw authFailure(AUTH_REFUSALS.unavailable)
    const capability = capabilityOf({ query, targets })
    if (capability !== null) {
      this.admitCapability({ request, capability, params, requirement })
      return true
    }
    await this.admitSession({ request, requirement })
    return true
  }

  /**
   * Binds the account an HLS session was opened for, when `capability` is
   * that session's and the route names it and its media. Any other is told
   * the session is gone, as a session that ended is, so the player opens
   * the master again with a new ticket.
   */
  private admitCapability({
    request,
    capability,
    params,
    requirement,
  }: {
    request: FastifyRequest
    capability: string
    params: Record<string, unknown>
    requirement: GatedRequirement
  }): void {
    const id = params[ROUTE_PARAMS.id]
    const session = params[HLS_PARAMS.session]
    const grant =
      isMediaIdParam(id) && isHlsSessionId(session)
        ? this.hls.grantOf({ mediaId: Number(id), session, capability })
        : null
    if (grant === null) throw noSuchSession()
    admit({ requirement, account: grant.account })
    this.sessions.bindTicket({ request, session: grant, unlockedUntil: grant.unlockedUntil })
  }

  /** Redeems an account ticket for the media id it names, and binds the account it stands for. */
  private async admitTicket({
    request,
    ticket,
    id,
    requirement,
  }: {
    request: FastifyRequest
    ticket: string
    id: unknown
    requirement: GatedRequirement
  }): Promise<void> {
    if (!isMediaIdParam(id)) throw authFailure(AUTH_REFUSALS.signedOut)
    const { session, unlockedUntil } = await this.tickets.redeem({ ticket, id: Number(id) })
    admit({ requirement, account: session.account })
    this.sessions.bindTicket({ request, session, unlockedUntil })
  }

  /** Authenticates Bearer, or the session cookie on a GET or HEAD, and binds its session. */
  private async admitSession({
    request,
    requirement,
  }: {
    request: FastifyRequest
    requirement: GatedRequirement
  }): Promise<void> {
    const authorization = request.headers[AUTH_HEADERS.authorization]
    const token = accessTokenOf({
      method: request.method,
      authorization,
      cookie: request.headers[AUTH_HEADERS.cookie],
    })
    if (token === null) throw authFailure(AUTH_REFUSALS.signedOut)
    const session = await this.sessions.authenticate({ token })
    admit({ requirement, account: session.account })
    this.sessions.bindSession({ request, session, isBearer: authorization !== undefined })
  }
}
