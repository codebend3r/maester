import { Injectable, type OnModuleDestroy } from '@nestjs/common'
import { type Notification, SERVER_EVENT_TYPES, type ServerEvent } from '@raven/core'
import { type Observable, Subject } from 'rxjs'
import type { AccountKey } from '@/media/viewingAccountKeys'

/**
 * An event with whom it is for: every stream, or only the streams of one account (its viewing
 * key), so one account's spots and binge list never reach another's screens.
 */
export type ServerEventEnvelope = { event: ServerEvent; account: AccountKey | null }

type NotifiedProps = { account: AccountKey; notification: Notification }

type IsForAccountProps = { envelope: ServerEventEnvelope; account: AccountKey }

/** Whether a stream opened by `account` is handed `envelope`. */
export const isForAccount = ({ envelope, account }: IsForAccountProps): boolean =>
  envelope.account === null || envelope.account === account

/** What changes as it happens, for the clients listening on `/api/events`. */
@Injectable()
export class ServerEvents implements OnModuleDestroy {
  private readonly subject = new Subject<ServerEventEnvelope>()

  /** A library's videos were added, removed, renamed or replaced. */
  libraryChanged(libraryId: number): void {
    this.subject.next({ event: { type: SERVER_EVENT_TYPES.library, libraryId }, account: null })
  }

  /** The account's viewing changed on one of its devices: a spot saved, a play counted, a mark made. */
  viewingChanged(account: AccountKey): void {
    this.subject.next({ event: { type: SERVER_EVENT_TYPES.viewing }, account })
  }

  /** The account's binge list changed on one of its devices. */
  bingeChanged(account: AccountKey): void {
    this.subject.next({ event: { type: SERVER_EVENT_TYPES.binge }, account })
  }

  /** The account was notified of something, logged already, for its screens to show. */
  notified({ account, notification }: NotifiedProps): void {
    this.subject.next({ event: { type: SERVER_EVENT_TYPES.notification, notification }, account })
  }

  stream(): Observable<ServerEventEnvelope> {
    return this.subject.asObservable()
  }

  /** Ends every open stream, so shutting down does not wait on a client that never hangs up. */
  onModuleDestroy(): void {
    this.subject.complete()
  }
}
