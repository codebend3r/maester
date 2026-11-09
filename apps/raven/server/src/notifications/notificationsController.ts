import { Body, Controller, Get, Header, Inject, Post, Req } from '@nestjs/common'
import { NOTIFICATION_PATHS, type Notification, isNotificationInput } from '@raven/core'
import { CACHE_POLICIES, HEADERS } from '@shared/server'
import type { FastifyRequest } from 'fastify'
import { ForViewers } from '@/admin/adminGuard'
import { ViewingAccounts } from '@/media/viewingAccounts'
import { NotificationsRepository } from '@/notifications/notificationsRepository'
import { parseBody } from '@/parseBody'

/** Each account's own notifications: read back, and logged as its screens show them. */
@Controller()
export class NotificationsController {
  constructor(
    @Inject(NotificationsRepository) private readonly log: NotificationsRepository,
    @Inject(ViewingAccounts) private readonly accounts: ViewingAccounts,
  ) {}

  /** The caller's notifications, newest first: only ever its own account's. */
  @Header(HEADERS.cacheControl, CACHE_POLICIES.noStore)
  @Get(NOTIFICATION_PATHS.own)
  list(@Req() request: FastifyRequest): Notification[] {
    return this.log.list(this.accounts.keyOf({ request }))
  }

  /** Logs a toast one of the caller's screens showed, under the caller's account: never one the body names. */
  @ForViewers()
  @Post(NOTIFICATION_PATHS.own)
  add(@Req() request: FastifyRequest, @Body() body: unknown): Notification {
    const { message, tone } = parseBody({
      guard: isNotificationInput,
      body,
      message: 'Send { message, tone }, tone being success, info or failure.',
    })
    return this.log.add({ account: this.accounts.keyOf({ request }), message, tone })
  }
}
