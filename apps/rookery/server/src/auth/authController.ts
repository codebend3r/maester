import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common'
import {
  type LogoutAnswer,
  type MeAnswer,
  PAGE_PATHS,
  QUERY_PARAMS,
  ROUTES,
  SESSION_ERRORS,
  SIGN_IN_ERRORS,
  type StartAnswer,
} from '@rookery/core'
import { HEADERS, HTTP_STATUSES, isRecord, readCookie } from '@shared/server'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { SERVER_CONFIG, type ServerConfig } from '@/config'
import {
  PIN_COOKIE,
  SESSION_COOKIE,
  clearedPinCookie,
  clearedSessionCookie,
  pinCookie,
  sessionCookie,
} from '@/auth/cookies'
import { SIGN_IN_RESULT_KINDS, SignInService } from '@/auth/signInService'
import { PlexUnavailable } from '@/plex/plexTv'
import { AccountService, toPublicUser } from '@/sessions/accountService'
import { SESSION_KINDS } from '@/sessions/sessionsRepository'

/** `return_to` from a JSON body, unchecked; `SignInService.returnTo` decides if it is safe. */
const returnToIn = (body: unknown): unknown =>
  isRecord(body) ? body[QUERY_PARAMS.returnTo] : undefined

const sessionToken = (request: FastifyRequest): string | null =>
  readCookie({ header: request.headers[HEADERS.cookie], name: SESSION_COOKIE })

@Controller()
export class AuthController {
  constructor(
    @Inject(SERVER_CONFIG) private readonly config: ServerConfig,
    @Inject(SignInService) private readonly signIn: SignInService,
    @Inject(AccountService) private readonly accounts: AccountService,
  ) {}

  @Post(ROUTES.start)
  @HttpCode(HTTP_STATUSES.ok)
  async start(
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<StartAnswer> {
    try {
      const { pendingId, authUrl } = await this.signIn.start({
        returnTo: returnToIn(body),
      })
      reply.header(HEADERS.setCookie, pinCookie({ id: pendingId, config: this.config }))
      return { auth_url: authUrl }
    } catch (error) {
      if (error instanceof PlexUnavailable) {
        throw new ServiceUnavailableException({ reason: SIGN_IN_ERRORS.plexUnavailable })
      }
      throw error
    }
  }

  @Get(ROUTES.callback)
  async callback(@Req() request: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
    const result = await this.signIn.complete({
      pendingId: readCookie({ header: request.headers[HEADERS.cookie], name: PIN_COOKIE }),
    })
    if (result.kind === SIGN_IN_RESULT_KINDS.signedIn) {
      reply.header(HEADERS.setCookie, [
        sessionCookie({ token: result.token, config: this.config }),
        clearedPinCookie({ config: this.config }),
      ])
      return void reply
        .code(HTTP_STATUSES.seeOther)
        .header(HEADERS.location, result.returnTo)
        .send()
    }
    const query = new URLSearchParams({
      [QUERY_PARAMS.error]: result.error,
      ...(result.returnTo && result.returnTo !== PAGE_PATHS.home
        ? { [QUERY_PARAMS.returnTo]: result.returnTo }
        : {}),
    })
    reply.header(HEADERS.setCookie, clearedPinCookie({ config: this.config }))
    return void reply
      .code(HTTP_STATUSES.seeOther)
      .header(HEADERS.location, `${PAGE_PATHS.login}?${query.toString()}`)
      .send()
  }

  @Post(ROUTES.logout)
  @HttpCode(HTTP_STATUSES.ok)
  logout(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): LogoutAnswer {
    this.signIn.signOut({ token: sessionToken(request) })
    reply.header(HEADERS.setCookie, clearedSessionCookie({ config: this.config }))
    return { next: this.signIn.returnTo({ value: returnToIn(body), fallback: PAGE_PATHS.login }) }
  }

  @Get(ROUTES.me)
  me(@Req() request: FastifyRequest): MeAnswer {
    const account = this.accounts.forToken(sessionToken(request))
    if (account.kind !== SESSION_KINDS.live) {
      throw new UnauthorizedException({ reason: SESSION_ERRORS.signedOut })
    }
    return { user: toPublicUser(account.user) }
  }
}
