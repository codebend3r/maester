import { Injectable, type OnModuleDestroy } from '@nestjs/common'
import type { ServerEvent } from '@raven/core'
import { type Observable, Subject } from 'rxjs'

/** What changes as it happens, for every client listening on `/api/events`. */
@Injectable()
export class ServerEvents implements OnModuleDestroy {
  private readonly subject = new Subject<ServerEvent>()

  /** A library's videos were added, removed, renamed or replaced. */
  libraryChanged(libraryId: number): void {
    this.subject.next({ type: 'library', libraryId })
  }

  stream(): Observable<ServerEvent> {
    return this.subject.asObservable()
  }

  /** Ends every open stream, so shutting down does not wait on a client that never hangs up. */
  onModuleDestroy(): void {
    this.subject.complete()
  }
}
