import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  Inject,
  Injectable,
} from '@nestjs/common'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { AuthSessions, accountOf } from '@/auth/authSessions'
import { CLOCK, type Clock } from '@/clock'
import { SERVER_CONFIG, type ServerConfig } from '@/config'
import { rateKeyOf } from '@/rateLimits/limitRavenRequests'
import {
  RATE_VERDICTS,
  RequestCounts,
  TOO_MANY_MESSAGES,
  TOO_MANY_REQUESTS,
  refusalOf,
} from '@/rateLimits/limitRequests'
import { ACCOUNT_STRICT_LIMIT, RATE_LIMITS, RATE_TIERS, rateTierOf } from '@/rateLimits/rateTiers'

type RefuseProps = Parameters<typeof refusalOf>[0]

const refuse = (props: RefuseProps): never => {
  throw new HttpException(refusalOf(props), TOO_MANY_REQUESTS)
}

/**
 * The `strict` tier, counted whole after the account gate, so the account is
 * the one the gate verified, not one a request names. Each request is
 * counted by its address first, the home network's too, so nothing that
 * passes for home can guess a secret: past its own 120 an address is
 * refused, signed in or not. Then a signed-in account is counted on its own
 * 30 a minute, so everyone behind a shared address keeps their own budget
 * and one of them guessing spends only theirs. A request with no account
 * (accounts off, or the open echo) is counted by its address alone.
 *
 * Full of addresses, the tier counts every new one in one shared window;
 * past that a request with no account is refused, while a signed-in one
 * goes by its own budget alone, so a flood of strangers that fills the tier
 * never locks an account out.
 */
@Injectable()
export class AccountRateGuard implements CanActivate {
  private readonly addresses = new RequestCounts(RATE_LIMITS[RATE_TIERS.strict])
  private readonly accounts = new RequestCounts(ACCOUNT_STRICT_LIMIT)

  constructor(
    @Inject(AuthSessions) private readonly auth: Pick<AuthSessions, 'callerOf'>,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(SERVER_CONFIG) private readonly config: ServerConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (rateTierOf([context.getHandler(), context.getClass()]) !== RATE_TIERS.strict) return true
    const http = context.switchToHttp()
    const request = http.getRequest<FastifyRequest>()
    const reply = http.getResponse<FastifyReply>()
    const key = await rateKeyOf({
      request,
      tier: RATE_TIERS.strict,
      proxySecret: this.config.remoteAccess.proxySecret,
    })
    const now = this.clock.now()
    const byAddress = this.addresses.hit({ key, now })
    if (byAddress.verdict === RATE_VERDICTS.limited) {
      return refuse({
        reply,
        retryAfterS: byAddress.retryAfterS,
        message: TOO_MANY_MESSAGES.address,
      })
    }
    const account = accountOf(this.auth.callerOf({ request }))
    if (account === null) {
      if (byAddress.verdict === RATE_VERDICTS.allowed) return true
      return refuse({
        reply,
        retryAfterS: byAddress.retryAfterS,
        message: TOO_MANY_MESSAGES.everyone,
      })
    }
    const byAccount = this.accounts.hit({ key: account.id, now })
    if (byAccount.verdict === RATE_VERDICTS.allowed) return true
    return refuse({ reply, retryAfterS: byAccount.retryAfterS, message: TOO_MANY_MESSAGES.account })
  }
}
