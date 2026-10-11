import { Controller, Inject, type MessageEvent, Sse } from '@nestjs/common'
import { type Observable, map } from 'rxjs'
import { ServerEvents } from '@/events/serverEvents'

@Controller('api/events')
export class EventsController {
  constructor(@Inject(ServerEvents) private readonly events: ServerEvents) {}

  /** Server-sent events, each a `ServerEvent` as JSON. */
  @Sse()
  stream(): Observable<MessageEvent> {
    return this.events.stream().pipe(map((event) => ({ data: event })))
  }
}
