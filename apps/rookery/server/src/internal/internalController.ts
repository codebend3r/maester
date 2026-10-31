import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Inject,
  NotFoundException,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common'
import { sameSecret } from '@shared/server'
import type { FastifyRequest } from 'fastify'
import { SERVER_CONFIG, type ServerConfig } from '@/config'
import { isRecord } from '@/guards'
import { ROUTES } from '@/routes'
import { AccountService, type PublicUser, toPublicUser } from '@/sessions/accountService'
import { SESSION_KINDS } from '@/sessions/sessionsRepository'

/** Why `/internal/session` refused before looking the token up. */
const INTERNAL_ERRORS = { serviceToken: 'service_token', tokenRequired: 'token_required' } as const

/** The `Authorization` scheme apps present the service token under, with its trailing space. */
const BEARER = 'Bearer '

/** What an app learns about the person behind a session cookie. */
export type SessionInfo = {
  user: PublicUser
  plex: { id: string; username: string | null; email: string | null } | null
  expires_at: string
}

/**
 * For the suite's other apps, never for browsers: sparrow posts the cookie's
 * value here to learn who it belongs to. The token travels in the body so it
 * stays out of access logs. The proxy should not expose `/internal/*`; the
 * service token guards it either way.
 */
@Controller()
export class InternalController {
  constructor(
    @Inject(SERVER_CONFIG) private readonly config: ServerConfig,
    @Inject(AccountService) private readonly accounts: AccountService,
  ) {}

  @Post(ROUTES.session)
  @HttpCode(200)
  session(@Req() request: FastifyRequest, @Body() body: unknown): SessionInfo {
    const header = request.headers.authorization ?? ''
    const given = header.startsWith(BEARER) ? header.slice(BEARER.length) : ''
    if (!given || !sameSecret({ given, expected: this.config.serviceToken })) {
      throw new UnauthorizedException({ reason: INTERNAL_ERRORS.serviceToken })
    }
    const token = isRecord(body) && typeof body.token === 'string' ? body.token : null
    if (!token) throw new BadRequestException({ reason: INTERNAL_ERRORS.tokenRequired })
    const account = this.accounts.forToken(token)
    if (account.kind !== SESSION_KINDS.live) throw new NotFoundException({ reason: account.kind })
    return {
      user: toPublicUser(account.user),
      plex: account.plex,
      expires_at: account.expiresAt,
    }
  }
}
