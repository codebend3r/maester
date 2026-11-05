import { Controller, Inject, type MessageEvent, Req, Res, Sse } from '@nestjs/common'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { type Observable, map, takeUntil } from 'rxjs'
import { AccessRechecks } from '@/auth/accessRechecks'
import { ServerEvents } from '@/events/serverEvents'
import { RAVEN_HEADERS } from '@/http'

/** What tells nginx (DSM's reverse proxy) to pass each event on at once instead of buffering it. */
const UNBUFFERED = 'no'

@Controller('api/events')
export class EventsController {
  constructor(
    @Inject(ServerEvents) private readonly events: ServerEvents,
    @Inject(AccessRechecks) private readonly rechecks: AccessRechecks,
  ) {}

  /**
   * Server-sent events, each a `ServerEvent` as JSON. Completes, so the
   * response ends cleanly, once the caller's account loses access; the
   * client's reconnect then meets the account gate.
   */
  @Sse()
  stream(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Observable<MessageEvent> {
    // Set on the raw response, since Nest writes an event stream's head itself and skips `@Header`.
    reply.raw.setHeader(RAVEN_HEADERS.accelBuffering, UNBUFFERED)
    return this.events.stream().pipe(
      takeUntil(this.rechecks.ended({ request })),
      map((event) => ({ data: event })),
    )
  }
}
