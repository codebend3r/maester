import type { Transport } from '@/apiClient/transport'
import { ROUTES } from '@/routes'
import { type Notification, type NotificationInput } from '@/contract'

/** The signed-in account's notifications: the toasts its screens showed, kept on the server. */
export const notificationCalls = ({ ask }: Transport) => ({
  /** The account's notifications, newest first. */
  listNotifications: (): Promise<Notification[]> => ask({ route: ROUTES.listNotifications }),

  /** Logs a toast a screen showed; answers it as kept. */
  logNotification: (input: NotificationInput): Promise<Notification> =>
    ask({ route: ROUTES.logNotification, body: input }),
})
