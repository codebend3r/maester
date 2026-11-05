import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Put,
  Req,
} from '@nestjs/common'
import {
  MEDIA_ORIGIN_KINDS,
  REMOTE_ACCESS_PARAMS,
  REMOTE_ACCESS_PATHS,
  type RemoteAccessState,
  isEchoNonce,
  isRemoteAccessChange,
  publicOriginOf,
} from '@raven/core'
import { CACHE_POLICIES, HEADERS } from '@shared/server'
import type { FastifyRequest } from 'fastify'
import { AdminOnly } from '@/admin/adminGuard'
import { OpenToAnyone } from '@/auth/accountGuard'
import { SERVER_CONFIG, type ServerConfig } from '@/config'
import { Public } from '@/lock/lockGuard'
import { parseBody } from '@/parseBody'
import { StrictlyLimited } from '@/rateLimits/rateTiers'
import { isAddressForwarded } from '@/remoteAccess/clientNetwork'
import { Reachability } from '@/remoteAccess/reachability'
import { SettingsRepository } from '@/settings/settingsRepository'

const NO_CONTENT = 204

type StateProps = { isFresh: boolean }

/**
 * Remote Access, as Plex's settings of that name: how raven is reached from
 * outside the home network, and whether it is. Only the owner sees or
 * changes it; the echo is what the outside check reaches.
 */
@Controller()
export class RemoteAccessController {
  constructor(
    @Inject(SERVER_CONFIG) private readonly config: ServerConfig,
    @Inject(SettingsRepository) private readonly settings: SettingsRepository,
    @Inject(Reachability) private readonly reachability: Reachability,
  ) {}

  /** The NAS's name on the home network, read off the `lan` media origin. */
  private privateAddress(): string | null {
    const lan = this.config.mediaPlane.origins.find(({ kind }) => kind === MEDIA_ORIGIN_KINDS.lan)
    return lan === undefined ? null : new URL(lan.url).hostname
  }

  private async state({ isFresh }: StateProps): Promise<RemoteAccessState> {
    const settings = this.settings.remoteAccess()
    return {
      settings,
      privateAddress: this.privateAddress(),
      publicOrigin: publicOriginOf(settings),
      status: await this.reachability.statusOf({ settings, isFresh }),
    }
  }

  @AdminOnly()
  @Header(HEADERS.cacheControl, CACHE_POLICIES.noStore)
  @Get(REMOTE_ACCESS_PATHS.settings)
  read(): Promise<RemoteAccessState> {
    return this.state({ isFresh: false })
  }

  /** Changes the fields sent and checks again from outside; an empty body only checks. */
  @AdminOnly()
  @Header(HEADERS.cacheControl, CACHE_POLICIES.noStore)
  @Put(REMOTE_ACCESS_PATHS.settings)
  save(@Body() body: unknown): Promise<RemoteAccessState> {
    const change = parseBody({
      guard: isRemoteAccessChange,
      body,
      message:
        'Each setting must be one of the values it takes: a DNS name, ports from 1 to 65535, an upload speed above 0 and a listed limit.',
    })
    this.settings.setRemoteAccess(change)
    return this.state({ isFresh: true })
  }

  /**
   * What the outside check fetches: 204 for a nonce a check in flight holds,
   * 404 for anything else. It holds nothing and says nothing more.
   */
  @OpenToAnyone()
  @Public()
  @HttpCode(NO_CONTENT)
  @Header(HEADERS.cacheControl, CACHE_POLICIES.noStore)
  @StrictlyLimited()
  @Get(REMOTE_ACCESS_PATHS.echo)
  echo(@Param(REMOTE_ACCESS_PARAMS.nonce) nonce: string, @Req() request: FastifyRequest): void {
    const isAnswered =
      isEchoNonce(nonce) &&
      this.reachability.answerEcho({ nonce, isAddressForwarded: isAddressForwarded({ request }) })
    if (!isAnswered) throw new NotFoundException()
  }
}
