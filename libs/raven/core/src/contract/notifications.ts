import { type Infer, isNumber, isString, listOf, object, oneOf } from '@/schema'

/*
 * Notifications: every toast an account's screens showed, kept on the server
 * as it appears so one missed while away can be read later. Each account
 * reads its own and no one else's.
 */

/** How a notification reads: something done, something to know, or something that failed. */
export const NOTIFICATION_TONES = {
  success: 'success',
  info: 'info',
  failure: 'failure',
} as const

export const isNotificationTone = oneOf(Object.values(NOTIFICATION_TONES))

export type NotificationTone = Infer<typeof isNotificationTone>

export const NOTIFICATION_PATHS = {
  /** The caller's own notifications, newest first; a POST logs one a screen showed. */
  own: '/api/notifications',
} as const

/** The most notifications the server keeps for one account; older ones go as new ones come. */
export const NOTIFICATIONS_KEPT = 1_000

/** The longest message a notification keeps, in characters. */
export const NOTIFICATION_MESSAGE_MOST = 500

/** A toast a screen showed and asks the server to log. */
export const isNotificationInput = object({
  message: isString,
  tone: isNotificationTone,
})

export type NotificationInput = Infer<typeof isNotificationInput>

/** One logged notification. */
export const isNotification = object({
  id: isNumber,
  message: isString,
  tone: isNotificationTone,
  /** When it appeared, as an ISO 8601 time. */
  at: isString,
})

export type Notification = Infer<typeof isNotification>

export const isNotificationList = listOf(isNotification)
