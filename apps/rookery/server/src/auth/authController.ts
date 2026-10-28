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
import { readCookie, HEADERS } from '@shared/server'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { SERVER_CONFIG, type ServerConfig } from '@/config'
import { isRecord } from '@/guards'
import { ROUTES } from '@/routes'
import {
  PIN_COOKIE,
  SESSION_COOKIE,
  clearedPinCookie,
  clearedSessionCookie,
  pinCookie,
  sessionCookie,
} from '@/auth/cookies'
import {
  PAGE_PATHS,
  SIGN_IN_ERRORS,
  SIGN_IN_RESULT_KINDS,
  SignInService,
} from '@/auth/signInService'
import { PlexUnavailable } from '@/plex/plexTv'
import { AccountService, type PublicUser, toPublicUser } from '@/sessions/accountService'
import { SESSION_KINDS } from '@/sessions/sessionsRepository'

/** The headers these routes set that `@shared/server`'s `HEADERS` does not name. */
const REPLY_HEADERS = { location: 'location' } as const

/** Why a route that needs a session refused the request. */
export const SESSION_ERRORS = { signedOut: 'signed_out' } as const

/** `return_to` from a JSON body, unchecked; `SignInService.returnTo` decides if it is safe. */
const returnToIn = (body: unknown): unknown => (isRecord(body) ? body.return_to : undefined)

const sessionToken = (request: FastifyRequest): string | null =>
  readCookie({ header: request.headers.cookie, name: SESSION_COOKIE })

@Controller()
export class AuthController {
  constructor(
    @Inject(SERVER_CONFIG) private readonly config: ServerConfig,
    @Inject(SignInService) private readonly signIn: SignInService,
    @Inject(AccountService) private readonly accounts: AccountService,
  ) {}

  @Post(ROUTES.start)
  @HttpCode(200)
  async start(
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ auth_url: string }> {
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
      pendingId: readCookie({ header: request.headers.cookie, name: PIN_COOKIE }),
    })
    if (result.kind === SIGN_IN_RESULT_KINDS.signedIn) {
      reply.header(HEADERS.setCookie, [
        sessionCookie({ token: result.token, config: this.config }),
        clearedPinCookie({ config: this.config }),
      ])
      return void reply.code(303).header(REPLY_HEADERS.location, result.returnTo).send()
    }
    const query = new URLSearchParams({
      error: result.error,
      ...(result.returnTo && result.returnTo !== PAGE_PATHS.home
        ? { return_to: result.returnTo }
        : {}),
    })
    reply.header(HEADERS.setCookie, clearedPinCookie({ config: this.config }))
    return void reply
      .code(303)
      .header(REPLY_HEADERS.location, `${PAGE_PATHS.login}?${query.toString()}`)
      .send()
  }

  @Post(ROUTES.logout)
  @HttpCode(200)
  logout(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): { next: string } {
    this.signIn.signOut({ token: sessionToken(request) })
    reply.header(HEADERS.setCookie, clearedSessionCookie({ config: this.config }))
    return { next: this.signIn.returnTo({ value: returnToIn(body), fallback: PAGE_PATHS.login }) }
  }

  @Get(ROUTES.me)
  me(@Req() request: FastifyRequest): { user: PublicUser } {
    const account = this.accounts.forToken(sessionToken(request))
    if (account.kind !== SESSION_KINDS.live) {
      throw new UnauthorizedException({ reason: SESSION_ERRORS.signedOut })
    }
    return { user: toPublicUser(account.user) }
  }
}
