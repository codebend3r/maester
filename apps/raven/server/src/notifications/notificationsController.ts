import { Body, Controller, Get, Header, Inject, Post } from '@nestjs/common'
import { NOTIFICATION_PATHS, type Notification, isNotificationInput } from '@raven/core'
import { CACHE_POLICIES, HEADERS } from '@shared/server'
import { ForViewers } from '@/admin/adminGuard'
import { NotificationsRepository } from '@/notifications/notificationsRepository'
import { parseBody } from '@/parseBody'
import { ViewingAccount } from '@/media/viewingAccountParam'
import type { AccountKey } from '@/media/viewingAccountKeys'

/** Each account's own notifications: read back, and logged as its screens show them. */
@Controller()
export class NotificationsController {
  constructor(@Inject(NotificationsRepository) private readonly log: NotificationsRepository) {}

  /** The caller's notifications, newest first: only ever its own account's. */
  @Header(HEADERS.cacheControl, CACHE_POLICIES.noStore)
  @Get(NOTIFICATION_PATHS.own)
  list(@ViewingAccount() account: AccountKey): Notification[] {
    return this.log.list(account)
  }

  /** Logs a toast one of the caller's screens showed, under the caller's account: never one the body names. */
  @ForViewers()
  @Post(NOTIFICATION_PATHS.own)
  add(@Body() body: unknown, @ViewingAccount() account: AccountKey): Notification {
    const { message, tone } = parseBody({
      guard: isNotificationInput,
      body,
      message: 'Send { message, tone }, tone being success, info or failure.',
    })
    return this.log.add({ account, message, tone })
  }
}
