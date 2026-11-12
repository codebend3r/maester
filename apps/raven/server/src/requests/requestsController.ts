import {
  BadGatewayException,
  Body,
  ConflictException,
  Controller,
  Get,
  Header,
  Inject,
  Post,
  Req,
  ServiceUnavailableException,
} from '@nestjs/common'
import {
  type TitleRequest,
  type TitleRequests,
  isTitleRequestAsk,
  REQUEST_PATHS,
} from '@raven/core'
import { CACHE_POLICIES, HEADERS } from '@shared/server'
import type { FastifyRequest } from 'fastify'
import { ForViewers } from '@/admin/adminGuard'
import { ViewingAccounts } from '@/media/viewingAccounts'
import { parseBody } from '@/parseBody'
import { ARR_ERROR_KINDS, ArrError } from '@/requests/arrClient'
import { DownloadRequests, RequestRefusal } from '@/requests/downloadRequests'

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
  constructor(
    @Inject(DownloadRequests) private readonly requests: DownloadRequests,
    @Inject(ViewingAccounts) private readonly accounts: ViewingAccounts,
  ) {}

  /** Every request and where it stands, and the caller's own budget. No library holds any of it. */
  @Header(HEADERS.cacheControl, CACHE_POLICIES.noStore)
  @Get(REQUEST_PATHS.requests)
  list(@Req() request: FastifyRequest): Promise<TitleRequests> {
    return this.requests.list({ account: this.accounts.keyOf({ request }) })
  }

  /** Asks for `{ type, tmdbId }` to be downloaded; 409 once someone has, or while the caller's budget is spent. */
  @ForViewers()
  @Post(REQUEST_PATHS.requests)
  async create(@Req() request: FastifyRequest, @Body() body: unknown): Promise<TitleRequest> {
    const ask = parseBody({
      guard: isTitleRequestAsk,
      body,
      message: 'Send { type, tmdbId }: a movie or show and its TMDB id.',
    })
    return this.requests.request({ account: this.accounts.keyOf({ request }), ask }).catch(answerOf)
  }
}
