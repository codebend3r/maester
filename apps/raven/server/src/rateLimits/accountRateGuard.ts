import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  Inject,
  Injectable,
} from '@nestjs/common'
import { HEADERS, RATE_VERDICTS, RequestCounts, TOO_MANY_REQUESTS } from '@shared/server'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { AuthSessions, accountOf } from '@/auth/authSessions'
import { CLOCK, type Clock } from '@/clock'
import { overflowOf } from '@/rateLimits/overflowRefusals'
import { ACCOUNT_STRICT_LIMIT, RATE_TIERS, rateTierOf } from '@/rateLimits/rateTiers'
import { isLanRequest } from '@/remoteAccess/clientNetwork'

/** What a refusal says, by whose budget ran out. */
const TOO_MANY_MESSAGES = {
  account: 'Too many requests for this account.',
  everyone: 'Too many requests from new addresses at once.',
} as const

type RefuseProps = {
  reply: FastifyReply
  retryAfterS: number
  message: (typeof TOO_MANY_MESSAGES)[keyof typeof TOO_MANY_MESSAGES]
}

const refuse = ({ reply, retryAfterS, message }: RefuseProps): never => {
  reply.header(HEADERS.retryAfter, String(retryAfterS))
  throw new HttpException(`${message} Try again in ${retryAfterS} seconds.`, TOO_MANY_REQUESTS)
}

/**
 * The `strict` routes' budget per account, beside the one per address. Run
 * after the account gate, so the account is the one the gate verified, not
 * one a request names: everyone behind a shared address keeps their own 30
 * a minute, and one of them guessing spends only their own. A request with
 * no account (accounts off, or the open echo) is counted by its address
 * alone, and the home network is never counted.
 *
 * It also answers the refusals a full `strict` tier's shared overflow window
 * left for it (`overflowRefusals`): a request with no account is refused
 * then, while a signed-in one goes by its own budget alone, so a flood of
 * strangers that fills the tier never locks an account out.
 */
@Injectable()
export class AccountRateGuard implements CanActivate {
  private readonly counts = new RequestCounts(ACCOUNT_STRICT_LIMIT)

  constructor(
    @Inject(AuthSessions) private readonly auth: Pick<AuthSessions, 'callerOf'>,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (rateTierOf([context.getHandler(), context.getClass()]) !== RATE_TIERS.strict) return true
    const http = context.switchToHttp()
    const request = http.getRequest<FastifyRequest>()
    if (isLanRequest({ request })) return true
    const reply = http.getResponse<FastifyReply>()
    const account = accountOf(this.auth.callerOf({ request }))
    if (account === null) {
      const overflowWait = overflowOf({ request })
      if (overflowWait === null) return true
      return refuse({ reply, retryAfterS: overflowWait, message: TOO_MANY_MESSAGES.everyone })
    }
    const counted = this.counts.hit({ key: account.id, now: this.clock.now() })
    if (counted.verdict === RATE_VERDICTS.allowed) return true
    return refuse({ reply, retryAfterS: counted.retryAfterS, message: TOO_MANY_MESSAGES.account })
  }
}
