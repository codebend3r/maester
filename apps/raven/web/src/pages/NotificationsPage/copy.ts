import { NOTIFICATION_TONES, type NotificationTone, plural } from '@raven/core'

export const NOTIFICATIONS_COPY = {
  title: 'Notifications',
  loading: 'Looking for notifications',
  serverDidNotAnswer: 'The server did not answer: ',
  nothingYet: 'No notifications yet. Every toast that appears is kept here.',
  summary: (count: number) =>
    `${plural({ n: count, one: 'notification', many: 'notifications' })}, newest first. Only your account's show here.`,
  tones: {
    [NOTIFICATION_TONES.success]: 'Done',
    [NOTIFICATION_TONES.info]: 'Note',
    [NOTIFICATION_TONES.failure]: 'Failed',
  } as const satisfies Record<NotificationTone, string>,
} as const
