import type { Transport } from '@/apiClient/transport'
import {
  NOTIFICATION_PATHS,
  type Notification,
  type NotificationInput,
  isNotification,
  isNotificationList,
} from '@/contract'

/** The signed-in account's notifications: the toasts its screens showed, kept on the server. */
export const notificationCalls = ({ send, expect }: Transport) => ({
  /** The account's notifications, newest first. */
  listNotifications: (): Promise<Notification[]> =>
    expect({ request: send({ path: NOTIFICATION_PATHS.own }), guard: isNotificationList }),

  /** Logs a toast a screen showed; answers it as kept. */
  logNotification: (input: NotificationInput): Promise<Notification> =>
    expect({
      request: send({ path: NOTIFICATION_PATHS.own, method: 'POST', body: input }),
      guard: isNotification,
    }),
})
