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
  AUTH_PARAMS,
  AUTH_REFUSALS,
  isRecord,
  isString,
  MEDIA_TICKET_PARAM,
} from '@raven/core'
import { CACHE_POLICIES, HEADERS } from '@shared/server'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { accessTokenOf } from '@/auth/accessToken'
import { ACCOUNT_TICKET_PREFIX, AccountTickets } from '@/auth/accountTickets'
import { authFailure } from '@/auth/authFailure'
import { AuthSessions, requireApproved } from '@/auth/authSessions'
import { isMediaPlaneRoute } from '@/media/mediaPlaneMark'
import { SERVER_CONFIG, type ServerConfig } from '@/config'

const ACCOUNT_ACCESS = Symbol('ACCOUNT_ACCESS')
export const ACCOUNT_REQUIREMENTS = {
  session: 'session',
  approved: 'approved',
  owner: 'owner',
} as const
export const RequireAccount = (
  requirement: (typeof ACCOUNT_REQUIREMENTS)[keyof typeof ACCOUNT_REQUIREMENTS],
) => SetMetadata(ACCOUNT_ACCESS, requirement)
const decorators = new Reflector()
const isMediaIdParam = (value: unknown): value is string =>
  isString(value) && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value))

@Injectable()
export class AccountGuard implements CanActivate {
  constructor(
    @Inject(AuthSessions) private readonly sessions: AuthSessions,
    @Inject(AccountTickets) private readonly tickets: AccountTickets,
    @Inject(SERVER_CONFIG) private readonly config: ServerConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()]
    const requirement: unknown = decorators.getAllAndOverride(ACCOUNT_ACCESS, targets)
    const isAccountRoute = Object.values(ACCOUNT_REQUIREMENTS).some(
      (known) => known === requirement,
    )
    const request = context.switchToHttp().getRequest<FastifyRequest>()
    const query = isRecord(request.query) ? request.query : {}
    const ticket = query[MEDIA_TICKET_PARAM]
    const isAccountTicket =
      isMediaPlaneRoute(targets) && isString(ticket) && ticket.startsWith(ACCOUNT_TICKET_PREFIX)
    if (!isAccountRoute && !isAccountTicket) return true
    const reply = context.switchToHttp().getResponse<FastifyReply>()
    reply
      .header(HEADERS.cacheControl, CACHE_POLICIES.noStore)
      .header(HEADERS.vary, `${AUTH_HEADERS.authorization}, ${AUTH_HEADERS.cookie}`)
    if (isAccountTicket) {
      const params = isRecord(request.params) ? request.params : {}
      const id = params[AUTH_PARAMS.id]
      if (!isMediaIdParam(id)) throw authFailure(AUTH_REFUSALS.signedOut)
      const account = await this.tickets.redeem({ ticket, id: Number(id) })
      this.sessions.bindTicket({ request, account })
      return true
    }
    if (this.config.auth.state !== AUTH_CONFIG_STATES.ready)
      throw authFailure(AUTH_REFUSALS.unavailable)
    const token = accessTokenOf({
      method: request.method,
      authorization: request.headers[AUTH_HEADERS.authorization],
      cookie: request.headers[AUTH_HEADERS.cookie],
    })
    if (token === null) throw authFailure(AUTH_REFUSALS.signedOut)
    const session = await this.sessions.authenticate({ token })
    if (requirement !== ACCOUNT_REQUIREMENTS.session) requireApproved(session.account)
    if (requirement === ACCOUNT_REQUIREMENTS.owner && !session.account.isOwner) {
      throw authFailure(AUTH_REFUSALS.notOwner)
    }
    this.sessions.bindSession({ request, session })
    return true
  }
}
