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
  AUTH_REFUSALS,
  type AuthConfig,
  type LastFmAuthPage,
  MEDIA_ORIGIN_KINDS,
  SCROBBLE_OUTCOMES,
  SCROBBLE_PARAMS,
  SCROBBLE_RETURNS,
  SCROBBLE_SERVICES,
  SCROBBLE_WEB_PATH,
  SCROBBLING_PATHS,
  type ScrobbleReturn,
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
import { isAccountOutage } from '@/auth/accessRechecks'
import { authFailure } from '@/auth/authFailure'
import { AuthSessions, requireApproved } from '@/auth/authSessions'
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

/** What the scrobbling routes tell a person when they refuse. */
const SCROBBLING_COPY = {
  badToken: 'token must be a user token',
  unknownToken: 'ListenBrainz does not know this token.',
  listenBrainzAway: 'ListenBrainz could not be reached.',
  lastFmOff: 'Last.fm is not set up on this server.',
  badReturn: 'returnTo must be Settings or Wren',
  callbackParts: 'token and state are both needed',
  staleSignIn: 'This sign-in has expired or was already used.',
  signInAgain: 'Sign in to raven again, then link Last.fm again.',
  noLongerViewer: 'This account can no longer link Last.fm.',
} as const

type ScrobblingControllerStatusOfProps = { account: AccountKey }

type ScrobblingControllerCheckStillViewerProps = { account: AccountKey }

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
@Controller()
@Public()
export class ScrobblingController {
  private readonly publicOrigin: string | null
  private readonly isAccountsReady: boolean

  constructor(
    @Inject(ScrobbleLinks) private readonly links: ScrobbleLinks,
    @Inject(ListenBrainzScrobbler) private readonly listenBrainz: ListenBrainzScrobbler,
    @Inject(LastFmScrobbler) private readonly lastFm: LastFmScrobbler,
    @Inject(LastFmSignIns) private readonly signIns: LastFmSignIns,
    @Inject(ViewingAccounts) private readonly accounts: ViewingAccounts,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AuthSessions)
    private readonly sessions: Pick<AuthSessions, 'freshestFor' | 'authenticate'>,
    @Inject(AUTH_STATE) auth: AuthConfig,
    @Inject(SERVER_CONFIG) config: ServerConfig,
  ) {
    this.publicOrigin = publicOriginOf({ auth, config })
    this.isAccountsReady = auth.state === AUTH_CONFIG_STATES.ready
  }

  /**
   * Refuses a sign-in whose account may no longer link. Without accounts
   * every account may. With them, the account's freshest live token in the
   * session store (as the access rechecks read it) is asked again now: no
   * live token is a 400 to sign in again, a refused or unapproved account a
   * 400, and an outage of the account service a 503, as everywhere else.
   */
  private async checkStillViewer({
    account,
  }: ScrobblingControllerCheckStillViewerProps): Promise<void> {
    if (!this.isAccountsReady) return
    const freshest = this.sessions.freshestFor({ accountId: account })
    if (freshest === null) throw new BadRequestException(SCROBBLING_COPY.signInAgain)
    try {
      const session = await this.sessions.authenticate({ token: freshest.token })
      requireApproved(session.account)
      if (session.account.id !== account) throw new Error('The token names another account.')
    } catch (error) {
      if (isAccountOutage(error)) throw authFailure(AUTH_REFUSALS.unavailable)
      throw new BadRequestException(SCROBBLING_COPY.noLongerViewer)
    }
  }

  /**
   * Where a named return sends the browser: the web's Settings on the web
   * address this server knows, or null while it knows none, and Wren's
   * screen as it is.
   */
  private addressOf(returnTo: ScrobbleReturn): string | null {
    switch (returnTo) {
      case SCROBBLE_RETURNS.web:
        return this.publicOrigin === null ? null : `${this.publicOrigin}${SCROBBLE_WEB_PATH}`
      case SCROBBLE_RETURNS.wren:
        return SCROBBLE_RETURNS.wren
      default: {
        const unreachable: never = returnTo
        return unreachable
      }
    }
  }

  /** Where Last.fm's sign-in comes back to while Last.fm is on, else null. */
  private lastFmOrigin(): string | null {
    return this.lastFm.isAvailable() ? this.publicOrigin : null
  }

  private statusOf({ account }: ScrobblingControllerStatusOfProps): ScrobbleStatus[] {
    const linked = this.links.list({ account })
    const available = {
      [SCROBBLE_SERVICES.listenBrainz]: this.listenBrainz.isAvailable(),
      [SCROBBLE_SERVICES.lastFm]: this.lastFmOrigin() !== null,
    }
    return Object.values(SCROBBLE_SERVICES).map((service) => ({
      service,
      isAvailable: available[service],
      username: linked.find((link) => link.service === service)?.username ?? null,
    }))
  }

  @Get(SCROBBLING_PATHS.root)
  status(@Req() request: FastifyRequest): ScrobbleStatus[] {
    return this.statusOf({ account: this.accounts.keyOf({ request }) })
  }

  /** Links ListenBrainz with the account's user token, once ListenBrainz says it is good. */
  @ForViewers()
  @Put(SCROBBLING_PATHS.listenBrainz)
  async linkListenBrainz(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): Promise<ScrobbleStatus[]> {
    if (!isListenBrainzLink(body)) throw new BadRequestException(SCROBBLING_COPY.badToken)
    const account = this.accounts.keyOf({ request })
    const linked = await this.listenBrainz.validate({ token: body.token }).catch(() => {
      throw new BadGatewayException(SCROBBLING_COPY.listenBrainzAway)
    })
    if (linked === null) throw new BadRequestException(SCROBBLING_COPY.unknownToken)
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
  @Post(SCROBBLING_PATHS.lastFmStart)
  @HttpCode(200)
  startLastFm(@Body() body: unknown, @Req() request: FastifyRequest): LastFmAuthPage {
    const origin = this.lastFmOrigin()
    if (origin === null) throw new ConflictException(SCROBBLING_COPY.lastFmOff)
    if (!isLastFmStart(body) || this.addressOf(body.returnTo) === null) {
      throw new BadRequestException(SCROBBLING_COPY.badReturn)
    }
    const state = this.signIns.start({
      account: this.accounts.keyOf({ request }),
      returnTo: body.returnTo,
    })
    const callback = `${origin}${SCROBBLING_PATHS.lastFmCallback}?${new URLSearchParams({ [SCROBBLE_PARAMS.state]: state }).toString()}`
    return { url: this.lastFm.authPage({ callback }) }
  }

  /**
   * Where Last.fm's page comes back to, with a one-use token, and the
   * state `start` signed, which names the account: open to anyone, since
   * no session rides along. A state that is not live, or whose account is
   * no longer approved, answers 400; anything else goes back to its return
   * address, saying how it went.
   */
  @OpenToAnyone()
  @Get(SCROBBLING_PATHS.lastFmCallback)
  async lastFmCallback(
    @Query(SCROBBLE_PARAMS.token) token: unknown,
    @Query(SCROBBLE_PARAMS.state) state: unknown,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    if (!isString(token) || token === '' || !isString(state)) {
      throw new BadRequestException(SCROBBLING_COPY.callbackParts)
    }
    const signIn = this.signIns.finish(state)
    const address = signIn === null ? null : this.addressOf(signIn.returnTo)
    if (signIn === null || address === null) {
      throw new BadRequestException(SCROBBLING_COPY.staleSignIn)
    }
    await this.checkStillViewer({ account: signIn.account })
    const linked = await this.lastFm.validate({ token }).catch(() => null)
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
      .redirect(returnAddress({ returnTo: address, outcome }), 302)
  }

  /** Stops forwarding to the service, forgetting its token and the listens waiting for it. */
  @ForViewers()
  @Delete(SCROBBLING_PATHS.service)
  unlink(@Param('service') service: string, @Req() request: FastifyRequest): ScrobbleStatus[] {
    if (!isScrobbleService(service)) throw new NotFoundException(`No service ${service}`)
    const account = this.accounts.keyOf({ request })
    this.links.remove({ account, service })
    return this.statusOf({ account })
  }
}
