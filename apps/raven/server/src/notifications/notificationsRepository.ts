import { Inject, Injectable } from '@nestjs/common'
import {
  NOTIFICATIONS_KEPT,
  NOTIFICATION_MESSAGE_MOST,
  type Notification,
  type NotificationInput,
  isNotificationTone,
} from '@raven/core'
import { DatabaseService } from '@/db/database'
import type { AccountKey, ByAccount } from '@/media/viewingAccountKeys'

type NotificationRow = { id: number; message: string; tone: string; at: string }

type NotificationsAddProps = NotificationInput & ByAccount & { at?: Date }

/** A row as the API answers it; a tone the schema's CHECK lets through is always one of core's. */
const toNotification = ({ id, message, tone, at }: NotificationRow): Notification[] =>
  isNotificationTone(tone) ? [{ id, message, tone, at }] : []

/**
 * Each account's notifications, its newest `NOTIFICATIONS_KEPT`. Every
 * statement binds the account, so one account's log never reaches another.
 */
@Injectable()
export class NotificationsRepository {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  private get db() {
    return this.database.db
  }

  /** Logs one notification for `account` and lets its oldest go past the cap; answers it as kept. */
  add({ account, message, tone, at = new Date() }: NotificationsAddProps): Notification {
    const kept = {
      account,
      message: message.slice(0, NOTIFICATION_MESSAGE_MOST),
      tone,
      at: at.toISOString(),
    }
    return this.db.transaction(() => {
      const id = Number(
        this.db
          .prepare(
            'INSERT INTO notifications (account_id, message, tone, at) VALUES (@account, @message, @tone, @at)',
          )
          .run(kept).lastInsertRowid,
      )
      this.db
        .prepare(
          `DELETE FROM notifications WHERE account_id = @account AND id <= (
             SELECT id FROM notifications WHERE account_id = @account
              ORDER BY id DESC LIMIT 1 OFFSET @kept)`,
        )
        .run({ account, kept: NOTIFICATIONS_KEPT })
      return { id, message: kept.message, tone, at: kept.at }
    })()
  }

  /** The account's notifications, newest first. */
  list(account: AccountKey): Notification[] {
    return this.db
      .prepare<ByAccount & { kept: number }, NotificationRow>(
        `SELECT id, message, tone, at FROM notifications WHERE account_id = @account
          ORDER BY id DESC LIMIT @kept`,
      )
      .all({ account, kept: NOTIFICATIONS_KEPT })
      .flatMap(toNotification)
  }
}
