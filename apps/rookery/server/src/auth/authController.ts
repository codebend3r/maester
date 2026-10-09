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
import type { FastifyReply, FastifyRequest } from 'fastify'
import { SERVER_CONFIG, type ServerConfig } from '@/config.js'
import {
  PIN_COOKIE,
  SESSION_COOKIE,
  clearedPinCookie,
  clearedSessionCookie,
  pinCookie,
  readCookie,
  sessionCookie,
} from '@/auth/cookies.js'
import { CALLBACK_PATH, SignInService } from '@/auth/signInService.js'
import { PlexUnavailable } from '@/plex/plexTv.js'
import { AccountService } from '@/sessions/accountService.js'

export type PublicUser = {
  id: string
  display_name: string
  email: string | null
  thumb: string | null
}

/** `return_to` from a JSON body, unchecked; `SignInService.returnTo` decides if it is safe. */
const returnToIn = (body: unknown): unknown =>
  typeof body === 'object' && body != null && 'return_to' in body ? body.return_to : undefined

const sessionToken = (request: FastifyRequest): string | null =>
  readCookie({ header: request.headers.cookie, name: SESSION_COOKIE })

@Controller()
export class AuthController {
  constructor(
    @Inject(SERVER_CONFIG) private readonly config: ServerConfig,
    @Inject(SignInService) private readonly signIn: SignInService,
    @Inject(AccountService) private readonly accounts: AccountService,
  ) {}

  @Post('api/auth/plex/start')
  @HttpCode(200)
  async start(
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ auth_url: string }> {
    try {
      const { pendingId, authUrl } = await this.signIn.start({
        returnTo: returnToIn(body),
      })
      reply.header('set-cookie', pinCookie({ id: pendingId, config: this.config }))
      return { auth_url: authUrl }
    } catch (error) {
      if (error instanceof PlexUnavailable) {
        throw new ServiceUnavailableException({ reason: 'plex_unavailable' })
      }
      throw error
    }
  }

  @Get(CALLBACK_PATH.slice(1))
  async callback(@Req() request: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
    const result = await this.signIn.complete({
      pendingId: readCookie({ header: request.headers.cookie, name: PIN_COOKIE }),
    })
    if (result.kind === 'signed_in') {
      reply.header('set-cookie', [
        sessionCookie({ token: result.token, config: this.config }),
        clearedPinCookie({ config: this.config }),
      ])
      return void reply.code(303).header('location', result.returnTo).send()
    }
    const query = new URLSearchParams({
      error: result.error,
      ...(result.returnTo && result.returnTo !== '/' ? { return_to: result.returnTo } : {}),
    })
    reply.header('set-cookie', clearedPinCookie({ config: this.config }))
    return void reply.code(303).header('location', `/login?${query.toString()}`).send()
  }

  @Post('api/auth/logout')
  @HttpCode(200)
  logout(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): { next: string } {
    this.signIn.signOut({ token: sessionToken(request) })
    reply.header('set-cookie', clearedSessionCookie({ config: this.config }))
    return { next: this.signIn.returnTo({ value: returnToIn(body), fallback: '/login' }) }
  }

  @Get('api/me')
  me(@Req() request: FastifyRequest): { user: PublicUser } {
    const account = this.accounts.forToken(sessionToken(request))
    if (account.kind !== 'live') throw new UnauthorizedException({ reason: 'signed_out' })
    const { id, displayName, email, thumb } = account.user
    return { user: { id, display_name: displayName, email, thumb } }
  }
}
