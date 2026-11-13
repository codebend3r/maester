import {
  BadGatewayException,
  Body,
  ConflictException,
  Controller,
  Get,
  Header,
  Inject,
  Param,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common'
import {
  type TitleHolding,
  type TitleRequest,
  type TitleRequests,
  isTitleRequestAsk,
  REQUEST_HOLDING_PATH,
  REQUEST_PATHS,
  UPCOMING_TITLE_PARAMS,
} from '@raven/core'
import { CACHE_POLICIES, HEADERS } from '@shared/server'
import { ForViewers } from '@/admin/adminGuard'
import { Public } from '@/lock/lockGuard'
import type { AccountKey } from '@/media/viewingAccountKeys'
import { ViewingAccount } from '@/media/viewingAccountParam'
import { parseBody } from '@/parseBody'
import { ARR_ERROR_KINDS, ArrError } from '@/requests/arrClient'
import { DownloadRequests, RequestRefusal } from '@/requests/downloadRequests'
import { titleAskOf } from '@/upcoming/titleAsk'

/** An arr's failure or a refused request as the route answers it; anything else is thrown on. */
const answerOf = (error: unknown): never => {
  if (error instanceof RequestRefusal) throw new ConflictException(error.message)
  if (error instanceof ArrError && error.kind === ARR_ERROR_KINDS.off) {
    throw new ServiceUnavailableException(error.message)
  }
  if (error instanceof ArrError) throw new BadGatewayException(error.message)
  throw error
}

/** Coming soon's requests: members ask for a title to be downloaded for everyone. */
@Controller()
export class RequestsController {
  constructor(@Inject(DownloadRequests) private readonly requests: DownloadRequests) {}

  /** Every request and where it stands, and the caller's own budget. No library holds any of it. */
  @Header(HEADERS.cacheControl, CACHE_POLICIES.noStore)
  @Get(REQUEST_PATHS.requests)
  list(@ViewingAccount() account: AccountKey): Promise<TitleRequests> {
    return this.requests.list({ account })
  }

  /**
   * Whether the title's arr holds it already, so the page says it is
   * requested instead of offering the button. Public to the PIN lock: no
   * library holds it.
   */
  @Header(HEADERS.cacheControl, CACHE_POLICIES.noStore)
  @Get(REQUEST_HOLDING_PATH)
  @Public()
  holding(
    @Param(UPCOMING_TITLE_PARAMS.type) type: string,
    @Param(UPCOMING_TITLE_PARAMS.tmdbId) tmdbId: string,
  ): Promise<TitleHolding> {
    return this.requests.holding(titleAskOf({ type, tmdbId })).catch(answerOf)
  }

  /** Asks for `{ type, tmdbId }` to be downloaded; 409 once someone has or its arr holds it already, or while the caller's budget is spent. */
  @ForViewers()
  @Post(REQUEST_PATHS.requests)
  async create(
    @ViewingAccount() account: AccountKey,
    @Body() body: unknown,
  ): Promise<TitleRequest> {
    const ask = parseBody({
      guard: isTitleRequestAsk,
      body,
      message: 'Send { type, tmdbId }: a movie or show and its TMDB id.',
    })
    return this.requests.request({ account, ask }).catch(answerOf)
  }
}
