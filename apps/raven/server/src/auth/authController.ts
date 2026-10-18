import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common'
import {
  AUTH_PARAMS,
  AUTH_PATHS,
  type Account,
  type AuthConfig,
  type MediaTicket,
  isAccountId,
  isMemberStatusChange,
  isString,
} from '@raven/core'
import { CACHE_POLICIES, HEADERS, wholeNumber } from '@shared/server'
import type { FastifyRequest } from 'fastify'
import { ForViewers } from '@/admin/adminGuard'
import { ACCOUNT_REQUIREMENTS, RequireAccount } from '@/auth/accountGuard'
import { AccountTickets } from '@/auth/accountTickets'
import { AuthBackend } from '@/auth/authBackend'
import { AuthSessions } from '@/auth/authSessions'
import { SERVER_CONFIG, type ServerConfig } from '@/config'
import { PrivateBy, Public } from '@/lock/lockGuard'
import { PRIVACIES } from '@/lock/lockService'
import { MediaIndex } from '@/media/mediaIndex'
import { parseBody } from '@/parseBody'

const pageNumber = (value: unknown): number | null => (isString(value) ? wholeNumber(value) : null)

@Controller()
@Public()
export class AuthController {
  constructor(
    @Inject(SERVER_CONFIG) private readonly config: ServerConfig,
    @Inject(AuthSessions) private readonly sessions: AuthSessions,
    @Inject(AuthBackend) private readonly backend: AuthBackend,
    @Inject(AccountTickets) private readonly tickets: AccountTickets,
    @Inject(MediaIndex) private readonly media: MediaIndex,
  ) {}

  @Header(HEADERS.cacheControl, CACHE_POLICIES.noStore)
  @Get(AUTH_PATHS.config)
  authConfig(): AuthConfig {
    return this.config.auth
  }

  @RequireAccount(ACCOUNT_REQUIREMENTS.session)
  @Get(AUTH_PATHS.me)
  me(@Req() request: FastifyRequest): Account {
    return this.sessions.sessionOf({ request }).account
  }

  @RequireAccount(ACCOUNT_REQUIREMENTS.owner)
  @Get(AUTH_PATHS.members)
  async members(
    @Req() request: FastifyRequest,
    @Query(AUTH_PARAMS.pageSize) size: unknown,
    @Query(AUTH_PARAMS.pageOffset) offset: unknown,
  ): Promise<Account[]> {
    const pageSize = size === undefined ? 100 : pageNumber(size)
    const pageOffset = offset === undefined ? 0 : pageNumber(offset)
    if (
      pageSize === null ||
      pageSize < 1 ||
      pageSize > 100 ||
      pageOffset === null ||
      !Number.isSafeInteger(pageOffset)
    ) {
      throw new BadRequestException('Invalid pagination.')
    }
    return this.backend.list({
      token: this.sessions.sessionOf({ request }).token,
      pageSize,
      pageOffset,
    })
  }

  @ForViewers()
  @RequireAccount(ACCOUNT_REQUIREMENTS.owner)
  @HttpCode(200)
  @Post(AUTH_PATHS.memberStatus)
  async setStatus(
    @Req() request: FastifyRequest,
    @Param(AUTH_PARAMS.id) id: string,
    @Body() body: unknown,
  ): Promise<Account> {
    if (!isAccountId(id)) throw new BadRequestException('Invalid account id.')
    const change = parseBody({
      guard: isMemberStatusChange,
      body,
      message: 'Expected approved or revoked status.',
    })
    return this.backend.setStatus({
      token: this.sessions.sessionOf({ request }).token,
      id: id.toLowerCase(),
      change,
    })
  }

  @ForViewers()
  @PrivateBy(PRIVACIES.media)
  @RequireAccount(ACCOUNT_REQUIREMENTS.approved)
  @HttpCode(200)
  @Post(AUTH_PATHS.ticket)
  ticket(
    @Req() request: FastifyRequest,
    @Param(AUTH_PARAMS.id, ParseIntPipe) id: number,
  ): MediaTicket {
    if (this.media.fileOf(id) === null) throw new NotFoundException('No media')
    return this.tickets.issue({ id, session: this.sessions.sessionOf({ request }) })
  }
}
