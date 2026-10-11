import { createHash, timingSafeEqual } from 'node:crypto'
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
import type { FastifyRequest } from 'fastify'
import { SERVER_CONFIG, type ServerConfig } from '@/config.js'
import type { PublicUser } from '@/auth/authController.js'
import { AccountService } from '@/sessions/accountService.js'

/** What an app learns about the person behind a session cookie. */
export type SessionInfo = {
  user: PublicUser
  plex: { id: string; username: string | null; email: string | null } | null
  expires_at: string
}

/** Hashing both sides first gives equal lengths, which `timingSafeEqual` needs. */
const sameSecret = ({ given, expected }: { given: string; expected: string }): boolean =>
  timingSafeEqual(
    createHash('sha256').update(given).digest(),
    createHash('sha256').update(expected).digest(),
  )

/**
 * For the suite's other apps, never for browsers: luwin posts the cookie's
 * value here to learn who it belongs to. The token travels in the body so it
 * stays out of access logs. The proxy should not expose `/internal/*`; the
 * service token guards it either way.
 */
@Controller('internal')
export class InternalController {
  constructor(
    @Inject(SERVER_CONFIG) private readonly config: ServerConfig,
    @Inject(AccountService) private readonly accounts: AccountService,
  ) {}

  @Post('session')
  @HttpCode(200)
  session(@Req() request: FastifyRequest, @Body() body: unknown): SessionInfo {
    const header = request.headers.authorization ?? ''
    const given = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : ''
    if (!given || !sameSecret({ given, expected: this.config.serviceToken })) {
      throw new UnauthorizedException({ reason: 'service_token' })
    }
    const token =
      typeof body === 'object' && body != null && 'token' in body && typeof body.token === 'string'
        ? body.token
        : null
    if (!token) throw new BadRequestException({ reason: 'token_required' })
    const account = this.accounts.forToken(token)
    if (account.kind !== 'live') throw new NotFoundException({ reason: account.kind })
    const { id, displayName, email, thumb } = account.user
    return {
      user: { id, display_name: displayName, email, thumb },
      plex: account.plex,
      expires_at: account.expiresAt,
    }
  }
}
