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
import { LIVE_STREAM_PATHS, type LiveStream, STREAM_PURPOSES } from '@raven/core'
import { CACHE_POLICIES, HEADERS, HTTP_STATUSES } from '@shared/server'
import type { FastifyRequest } from 'fastify'
import { AdminOnly } from '@/admin/adminGuard'
import { AuthSessions, accountOf } from '@/auth/authSessions'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { Public } from '@/lock/lockGuard'
import { MediaRepository } from '@/media/mediaRepository'
import { describeClient } from '@/streams/clientInfo'
import { type StreamSession, StreamSessions } from '@/streams/streamSessions'
import { ROUTE_PARAMS } from '@/requestParts'
import { ViewingAccount } from '@/media/viewingAccountParam'
import type { AccountKey } from '@/media/viewingAccountKeys'

type LiveStreamsOfProps = { sessions: readonly StreamSession[]; account: AccountKey }

/** Who is streaming what: the admin sees and stops everyone's, an account sees its own. */
@Controller()
export class StreamsController {
  constructor(
    @Inject(StreamSessions) private readonly sessions: StreamSessions,
    @Inject(MediaRepository) private readonly media: MediaRepository,
    @Inject(LibrariesRepository) private readonly libraries: LibrariesRepository,
    @Inject(AuthSessions) private readonly auth: Pick<AuthSessions, 'callerOf'>,
  ) {}

  /** Live as of this request, so never cached; each video as the owner asking sees it. */
  @AdminOnly()
  @Header(HEADERS.cacheControl, CACHE_POLICIES.noStore)
  @Get(LIVE_STREAM_PATHS.everyone)
  list(@ViewingAccount() account: AccountKey): LiveStream[] {
    return this.liveStreamsOf({ sessions: this.sessions.list(), account })
  }

  /**
   * The caller's own live streams, matched by the account each stream was
   * opened under. A server without accounts has no account to match, and its
   * streams name no viewer, so the legacy browser is answered none: who else
   * is watching, from where and on what, stays the admin's to see.
   */
  @Header(HEADERS.cacheControl, CACHE_POLICIES.noStore)
  @Get(LIVE_STREAM_PATHS.mine)
  mine(@Req() request: FastifyRequest, @ViewingAccount() account: AccountKey): LiveStream[] {
    const viewerId = accountOf(this.auth.callerOf({ request }))?.id ?? null
    if (viewerId === null) return []
    const own = this.sessions.list().filter((session) => session.client.viewer?.id === viewerId)
    return this.liveStreamsOf({ sessions: own, account })
  }

  /**
   * Cuts the stream's connections and kills its ffmpeg. The player is free
   * to ask again, and a stream that came back is a new one.
   */
  @AdminOnly()
  @Public()
  @Post(LIVE_STREAM_PATHS.stop)
  @HttpCode(HTTP_STATUSES.noContent)
  stop(@Param(ROUTE_PARAMS.id) id: string): void {
    if (!this.sessions.stop(id)) throw new NotFoundException('That stream is not live any more')
  }

  private liveStreamsOf({ sessions, account }: LiveStreamsOfProps): LiveStream[] {
    return sessions.flatMap((session): LiveStream[] => {
      const media = this.media.get({ id: session.mediaId, account })
      if (media == null) return []
      const stream = {
        id: session.id,
        media,
        libraryName: this.libraries.get(media.libraryId)?.name ?? '',
        mode: session.mode,
        ...describeClient(session.client.userAgent),
        address: session.client.address,
        startedAt: new Date(session.startedAt).toISOString(),
        lastSeenAt: new Date(session.lastSeenAt).toISOString(),
        position: session.position,
        viewer: session.client.viewer?.email ?? null,
        audio: session.audio,
        sendRate: session.sendRate,
        quality: session.quality,
      }
      return [
        session.purpose === STREAM_PURPOSES.download
          ? {
              ...stream,
              purpose: STREAM_PURPOSES.download,
              received: Math.min(session.reached, media.size),
            }
          : { ...stream, purpose: STREAM_PURPOSES.play },
      ]
    })
  }
}
