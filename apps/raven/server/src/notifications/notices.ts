import { Inject, Injectable } from '@nestjs/common'
import type { Notification, NotificationInput } from '@raven/core'
import { ServerEvents } from '@/events/serverEvents'
import type { ByAccount } from '@/media/viewingAccountKeys'
import { NotificationsRepository } from '@/notifications/notificationsRepository'

type NoticesNotifyProps = NotificationInput & ByAccount

/**
 * What the server tells one account as work it started goes on: logged
 * first, so it is there to read when no screen of the account is open, then
 * sent to the account's screens to show as a toast.
 */
@Injectable()
export class Notices {
  constructor(
    @Inject(NotificationsRepository) private readonly log: NotificationsRepository,
    @Inject(ServerEvents) private readonly events: ServerEvents,
  ) {}

  notify({ account, message, tone }: NoticesNotifyProps): Notification {
    const notification = this.log.add({ account, message, tone })
    this.events.notified({ account, notification })
    return notification
  }
}
