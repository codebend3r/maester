import {
  BadGatewayException,
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common'
import {
  AUTH_CONFIG_STATES,
  type AuthConfig,
  type LastFmAuthPage,
  MEDIA_ORIGIN_KINDS,
  SCROBBLE_OUTCOMES,
  SCROBBLE_PARAMS,
  SCROBBLE_RETURNS,
  SCROBBLE_SERVICES,
  SCROBBLING_PATHS,
  type ScrobbleStatus,
  isLastFmStart,
  isListenBrainzLink,
  isScrobbleService,
  isString,
} from '@raven/core'
import { CACHE_POLICIES, HEADERS } from '@shared/server'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { ForViewers } from '@/admin/adminGuard'
import { OpenToAnyone } from '@/auth/accountGuard'
import { AUTH_STATE } from '@/auth/effectiveAuth'
import { CLOCK, type Clock } from '@/clock'
import { SERVER_CONFIG, type ServerConfig } from '@/config'
import { Public } from '@/lock/lockGuard'
import type { AccountKey } from '@/media/viewingAccountKeys'
import { ViewingAccounts } from '@/media/viewingAccounts'
import { LastFmScrobbler } from '@/scrobbling/lastFmScrobbler'
import { LastFmSignIns } from '@/scrobbling/lastFmSignIns'
import { ListenBrainzScrobbler } from '@/scrobbling/listenBrainzScrobbler'
import { ScrobbleLinks } from '@/scrobbling/scrobbleLinks'

type PublicOriginOfProps = { auth: AuthConfig; config: ServerConfig }

/**
 * Where browsers reach this server, for Last.fm's callback and the web's
 * return: the web app's own origin once accounts are ready (`RAVEN_WEB_URL`,
 * which serves `/api` too, on Netlify through its proxy), else the public
 * media origin, else none, which leaves Last.fm's sign-in off.
 */
const publicOriginOf = ({ auth, config }: PublicOriginOfProps): string | null => {
  if (auth.state === AUTH_CONFIG_STATES.ready) return auth.webUrl
  return (
    config.mediaPlane.origins.find((origin) => origin.kind === MEDIA_ORIGIN_KINDS.public)?.url ??
    null
  )
}

type ScrobblingControllerStatusOfProps = { account: AccountKey }

type ReturnAddressProps = { returnTo: string; outcome: string }

/** The return address with how the sign-in ended in `?scrobbling=`. */
const returnAddress = ({ returnTo, outcome }: ReturnAddressProps): string =>
  `${returnTo}?${new URLSearchParams({ [SCROBBLE_PARAMS.outcome]: outcome }).toString()}`

/**
 * The calling account's scrobbling: which services it forwards its listens
 * to. Every account may link, the `'local'` one of a server without
 * accounts too. Nothing here names a library, so the lock holds nothing
 * back; a token or session key never leaves the server.
 */
@Controller('api/me/scrobbling')
@Public()
export class ScrobblingController {
  private readonly publicOrigin: string | null

  constructor(
    @Inject(ScrobbleLinks) private readonly links: ScrobbleLinks,
    @Inject(ListenBrainzScrobbler) private readonly listenBrainz: ListenBrainzScrobbler,
    @Inject(LastFmScrobbler) private readonly lastFm: LastFmScrobbler,
    @Inject(LastFmSignIns) private readonly signIns: LastFmSignIns,
    @Inject(ViewingAccounts) private readonly accounts: ViewingAccounts,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AUTH_STATE) auth: AuthConfig,
    @Inject(SERVER_CONFIG) config: ServerConfig,
  ) {
    this.publicOrigin = publicOriginOf({ auth, config })
  }

  /** The exact addresses Last.fm's sign-in may go back to. */
  private returns(): string[] {
    return [
      ...(this.publicOrigin === null ? [] : [`${this.publicOrigin}${SCROBBLE_RETURNS.web}`]),
      SCROBBLE_RETURNS.wren,
    ]
  }

  private isLastFmOpen(): boolean {
    return this.lastFm.isAvailable() && this.publicOrigin !== null
  }

  private statusOf({ account }: ScrobblingControllerStatusOfProps): ScrobbleStatus[] {
    const linked = this.links.list({ account })
    const available = {
      [SCROBBLE_SERVICES.listenBrainz]: this.listenBrainz.isAvailable(),
      [SCROBBLE_SERVICES.lastFm]: this.isLastFmOpen(),
    }
    return Object.values(SCROBBLE_SERVICES).map((service) => ({
      service,
      isAvailable: available[service],
      username: linked.find((link) => link.service === service)?.username ?? null,
    }))
  }

  @Get()
  status(@Req() request: FastifyRequest): ScrobbleStatus[] {
    return this.statusOf({ account: this.accounts.keyOf({ request }) })
  }

  /** Links ListenBrainz with the account's user token, once ListenBrainz says it is good. */
  @ForViewers()
  @Put('listenbrainz')
  async linkListenBrainz(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): Promise<ScrobbleStatus[]> {
    if (!isListenBrainzLink(body)) throw new BadRequestException('token must be a user token')
    const account = this.accounts.keyOf({ request })
    const linked = await this.listenBrainz.validate({ token: body.token }).catch(() => {
      throw new BadGatewayException('ListenBrainz could not be reached.')
    })
    if (linked === null) throw new BadRequestException('ListenBrainz does not know this token.')
    this.links.save({
      account,
      service: SCROBBLE_SERVICES.listenBrainz,
      username: linked.username,
      secret: linked.secret,
      at: new Date(this.clock.now()),
    })
    return this.statusOf({ account })
  }

  /** Last.fm's sign-in page for the account, which comes back to `returnTo` once allowed. */
  @ForViewers()
  @Post('lastfm/start')
  @HttpCode(200)
  startLastFm(@Body() body: unknown, @Req() request: FastifyRequest): LastFmAuthPage {
    if (!this.isLastFmOpen() || this.publicOrigin === null) {
      throw new ConflictException('Last.fm is not set up on this server.')
    }
    if (!isLastFmStart(body) || !this.returns().includes(body.returnTo)) {
      throw new BadRequestException('returnTo must be Settings or Wren')
    }
    const state = this.signIns.start({
      account: this.accounts.keyOf({ request }),
      returnTo: body.returnTo,
    })
    const callback = `${this.publicOrigin}${SCROBBLING_PATHS.lastFmCallback}?${new URLSearchParams({ [SCROBBLE_PARAMS.state]: state }).toString()}`
    return { url: this.lastFm.authPage({ callback }) }
  }

  /**
   * Where Last.fm's page comes back to, with a one-use token, and the
   * state `start` signed, which names the account: open to anyone, since
   * no session rides along. A state that is not live answers 400; anything
   * else goes back to its return address, saying how it went.
   */
  @OpenToAnyone()
  @Get('lastfm/callback')
  async lastFmCallback(
    @Query(SCROBBLE_PARAMS.token) token: unknown,
    @Query(SCROBBLE_PARAMS.state) state: unknown,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    if (!isString(token) || token === '' || !isString(state)) {
      throw new BadRequestException('token and state are both needed')
    }
    const signIn = this.signIns.finish(state)
    if (signIn === null || !this.returns().includes(signIn.returnTo)) {
      throw new BadRequestException('This sign-in has expired or was already used.')
    }
    const linked = this.lastFm.isAvailable()
      ? await this.lastFm.validate({ token }).catch(() => null)
      : null
    if (linked !== null) {
      this.links.save({
        account: signIn.account,
        service: SCROBBLE_SERVICES.lastFm,
        username: linked.username,
        secret: linked.secret,
        at: new Date(this.clock.now()),
      })
    }
    const outcome = linked === null ? SCROBBLE_OUTCOMES.failed : SCROBBLE_OUTCOMES.linked
    await reply
      .header(HEADERS.cacheControl, CACHE_POLICIES.noStore)
      .redirect(returnAddress({ returnTo: signIn.returnTo, outcome }), 302)
  }

  /** Stops forwarding to the service, forgetting its token and the listens waiting for it. */
  @ForViewers()
  @Delete(':service')
  unlink(@Param('service') service: string, @Req() request: FastifyRequest): ScrobbleStatus[] {
    if (!isScrobbleService(service)) throw new NotFoundException(`No service ${service}`)
    const account = this.accounts.keyOf({ request })
    this.links.remove({ account, service })
    return this.statusOf({ account })
  }
}
