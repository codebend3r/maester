import { Controller, Inject, type MessageEvent, Req, Sse } from '@nestjs/common'
import type { FastifyRequest } from 'fastify'
import { type Observable, map, takeUntil } from 'rxjs'
import { AccessRechecks } from '@/auth/accessRechecks'
import { ServerEvents } from '@/events/serverEvents'

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
  stream(@Req() request: FastifyRequest): Observable<MessageEvent> {
    return this.events.stream().pipe(
      takeUntil(this.rechecks.ended({ request })),
      map((event) => ({ data: event })),
    )
  }
}
