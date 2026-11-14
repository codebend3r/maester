import { randomBytes } from 'node:crypto'
import { Controller, Get, Header, Inject, Logger, Query, Req, Res } from '@nestjs/common'
import {
  AUTH_CONFIG_STATES,
  type AuthConfig,
  MEDIA_ORIGIN_KINDS,
  MEDIA_PROBE_BYTES,
  type MediaOrigin,
  type MediaOrigins,
  type RemoteAccessSettings,
  publicOriginOf,
  remoteQualityFor,
} from '@raven/core'
import { CONTENT_TYPES, HEADERS, wholeNumber, CACHE_POLICIES } from '@shared/server'
import type { FastifyReply } from 'fastify'
import { OpenToAnyone } from '@/auth/accountGuard'
import { AUTH_STATE } from '@/auth/effectiveAuth'
import { SERVER_CONFIG, type ServerConfig } from '@/config'
import { Public } from '@/lock/lockGuard'
import { MediaPlane } from '@/media/mediaPlaneMark'
import { MediaTickets } from '@/media/mediaTickets'
import { type ClientRequest, isLanRequest } from '@/remoteAccess/clientNetwork'
import { SettingsRepository } from '@/settings/settingsRepository'
import { QUERY_PARAMS, queryText } from '@/queryValues'

const MAX_PROBE_BYTES = 1_048_576

type OriginsProps = { remoteAccess: RemoteAccessSettings }

/**
 * Where a browser may fetch media from directly, and the speed probe it
 * picks between them with. The origins are only offered while a request to
 * another origin can carry proof of who sent it: an account ticket once
 * accounts are ready, else a ticket signed with the media secret. They are
 * `RAVEN_MEDIA_ORIGINS`, then the public origin Remote Access names.
 */
@Controller('api/media-origins')
export class MediaOriginsController {
  private readonly noise = randomBytes(MAX_PROBE_BYTES)

  constructor(
    @Inject(SERVER_CONFIG) private readonly config: ServerConfig,
    @Inject(MediaTickets) private readonly tickets: MediaTickets,
    @Inject(AUTH_STATE) private readonly auth: AuthConfig,
    @Inject(SettingsRepository)
    private readonly settings: Pick<SettingsRepository, 'remoteAccess'>,
  ) {
    const logger = new Logger(MediaOriginsController.name)
    const problems = [
      ...config.mediaPlane.problems,
      ...(auth.state === AUTH_CONFIG_STATES.off ? config.mediaPlane.secretProblems : []),
    ]
    problems.forEach((problem) => logger.warn(problem))
  }

  @Header(HEADERS.cacheControl, CACHE_POLICIES.noStore)
  @Get()
  list(@Req() request: ClientRequest): MediaOrigins {
    const isOffered = this.auth.state === AUTH_CONFIG_STATES.ready || this.tickets.isOn
    const remoteAccess = this.settings.remoteAccess()
    return {
      origins: isOffered ? this.origins({ remoteAccess }) : [],
      // Every viewer learns the remote limit, so a player away from home asks for a transcode at it.
      remote: {
        limit: remoteQualityFor(remoteAccess),
        isOutside: !isLanRequest({ request }),
      },
    }
  }

  private origins({ remoteAccess }: OriginsProps): MediaOrigin[] {
    const listed = this.config.mediaPlane.origins
    const url = publicOriginOf(remoteAccess)
    const isListed = listed.some((origin) => origin.url === url)
    return url === null || isListed ? listed : [...listed, { kind: MEDIA_ORIGIN_KINDS.public, url }]
  }

  /**
   * `bytes` of random noise, kept in memory so the probe measures the
   * network and not the disk, and random so nothing on the way can shrink it.
   */
  @OpenToAnyone()
  @Public()
  @MediaPlane()
  @Get('ping')
  async ping(@Query(QUERY_PARAMS.bytes) bytes: unknown, @Res() reply: FastifyReply): Promise<void> {
    const asked =
      wholeNumber(queryText({ value: bytes, name: QUERY_PARAMS.bytes })) ?? MEDIA_PROBE_BYTES
    const length = Math.min(Math.max(asked, 1), MAX_PROBE_BYTES)
    await reply
      .header(HEADERS.contentType, CONTENT_TYPES.octetStream)
      .header(HEADERS.contentLength, length)
      .header(HEADERS.cacheControl, CACHE_POLICIES.noStore)
      .send(this.noise.subarray(0, length))
  }
}
