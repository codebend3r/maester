import { randomBytes } from 'node:crypto'
import { Controller, Get, Header, Inject, Logger, Query, Res } from '@nestjs/common'
import {
  AUTH_CONFIG_STATES,
  type AuthConfig,
  MEDIA_PROBE_BYTES,
  type MediaOrigins,
} from '@raven/core'
import { CONTENT_TYPES, HEADERS, wholeNumber, CACHE_POLICIES } from '@shared/server'
import type { FastifyReply } from 'fastify'
import { OpenToAnyone } from '@/auth/accountGuard'
import { AUTH_STATE } from '@/auth/effectiveAuth'
import { SERVER_CONFIG, type ServerConfig } from '@/config'
import { Public } from '@/lock/lockGuard'
import { MediaPlane } from '@/media/mediaPlaneMark'
import { MediaTickets } from '@/media/mediaTickets'

const MAX_PROBE_BYTES = 1_048_576

/**
 * Where a browser may fetch media from directly, and the speed probe it
 * picks between them with. The origins are only offered while a request to
 * another origin can carry proof of who sent it: an account ticket once
 * accounts are ready, else a ticket signed with the media secret.
 */
@Controller('api/media-origins')
export class MediaOriginsController {
  private readonly noise = randomBytes(MAX_PROBE_BYTES)

  constructor(
    @Inject(SERVER_CONFIG) private readonly config: ServerConfig,
    @Inject(MediaTickets) private readonly tickets: MediaTickets,
    @Inject(AUTH_STATE) private readonly auth: AuthConfig,
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
  list(): MediaOrigins {
    const isOffered = this.auth.state === AUTH_CONFIG_STATES.ready || this.tickets.isOn
    return { origins: isOffered ? this.config.mediaPlane.origins : [] }
  }

  /**
   * `bytes` of random noise, kept in memory so the probe measures the
   * network and not the disk, and random so nothing on the way can shrink it.
   */
  @OpenToAnyone()
  @Public()
  @MediaPlane()
  @Get('ping')
  async ping(@Query('bytes') bytes: string | undefined, @Res() reply: FastifyReply): Promise<void> {
    const asked = wholeNumber(bytes) ?? MEDIA_PROBE_BYTES
    const length = Math.min(Math.max(asked, 1), MAX_PROBE_BYTES)
    await reply
      .header(HEADERS.contentType, CONTENT_TYPES.octetStream)
      .header(HEADERS.contentLength, length)
      .header(HEADERS.cacheControl, CACHE_POLICIES.noStore)
      .send(this.noise.subarray(0, length))
  }
}
