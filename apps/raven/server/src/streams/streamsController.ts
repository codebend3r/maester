import {
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
} from '@nestjs/common'
import type { LiveStream } from '@raven/core'
import { CACHE_POLICIES, HEADERS } from '@shared/server'
import type { FastifyRequest } from 'fastify'
import { AdminOnly } from '@/admin/adminGuard'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { Public } from '@/lock/lockGuard'
import { MediaRepository } from '@/media/mediaRepository'
import { ViewingAccounts } from '@/media/viewingAccounts'
import { describeClient } from '@/streams/clientInfo'
import { StreamSessions } from '@/streams/streamSessions'

/** Who is streaming what, for the admin to see and to stop. */
@Controller('api/streams')
@AdminOnly()
export class StreamsController {
  constructor(
    @Inject(StreamSessions) private readonly sessions: StreamSessions,
    @Inject(MediaRepository) private readonly media: MediaRepository,
    @Inject(LibrariesRepository) private readonly libraries: LibrariesRepository,
    @Inject(ViewingAccounts) private readonly accounts: ViewingAccounts,
  ) {}

  /** Live as of this request, so never cached; each video as the owner asking sees it. */
  @Header(HEADERS.cacheControl, CACHE_POLICIES.noStore)
  @Get()
  list(@Req() request: FastifyRequest): LiveStream[] {
    const account = this.accounts.keyOf({ request })
    return this.sessions.list().flatMap((session): LiveStream[] => {
      const media = this.media.get({ id: session.mediaId, account })
      if (media == null) return []
      return [
        {
          id: session.id,
          media,
          libraryName: this.libraries.get(media.libraryId)?.name ?? '',
          mode: session.mode,
          ...describeClient(session.client.userAgent),
          address: session.client.address,
          startedAt: new Date(session.startedAt).toISOString(),
          lastSeenAt: new Date(session.lastSeenAt).toISOString(),
          position: session.position,
        },
      ]
    })
  }

  /**
   * Cuts the stream's connections and kills its ffmpeg. The player is free
   * to ask again, and a stream that came back is a new one.
   */
  @Public()
  @Post(':id/stop')
  @HttpCode(204)
  stop(@Param('id') id: string): void {
    if (!this.sessions.stop(id)) throw new NotFoundException('That stream is not live any more')
  }
}
