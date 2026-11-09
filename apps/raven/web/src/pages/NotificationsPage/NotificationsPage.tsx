import { useQuery } from '@tanstack/react-query'
import { NOTIFICATION_TONES, type Notification, type NotificationTone } from '@raven/core'
import { Icon, NOTIFICATION_ICONS } from '@raven/ui'
import { BackButton, HOME } from '@/components/BackButton/BackButton'
import { PageTitle } from '@/components/PageTitle/PageTitle'
import { Bone, Loading } from '@/components/Skeleton/Skeleton'
import { notificationsQuery } from '@/lib/queries'
import { NOTIFICATIONS_COPY } from '@/pages/NotificationsPage/copy'
import styles from '@/pages/NotificationsPage/NotificationsPage.module.scss'

const when = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' })

/** The class that colours each tone's mark. */
const TONE_CLASSES = {
  [NOTIFICATION_TONES.success]: styles.success,
  [NOTIFICATION_TONES.info]: styles.info,
  [NOTIFICATION_TONES.failure]: styles.failure,
} as const satisfies Record<NotificationTone, string | undefined>

type NotificationRowProps = { notification: Notification }

const NotificationRow = ({ notification }: NotificationRowProps) => (
  <li className={styles.row}>
    <span className={[styles.mark, TONE_CLASSES[notification.tone]].filter(Boolean).join(' ')}>
      <Icon name={NOTIFICATION_ICONS[notification.tone]} />
      <span className="visually-hidden">{NOTIFICATIONS_COPY.tones[notification.tone]}</span>
    </span>
    <p className={styles.message}>{notification.message}</p>
    <time className={styles.time} dateTime={notification.at}>
      {when.format(new Date(notification.at))}
    </time>
  </li>
)

/** A few rows on their way. */
const RowsSkeleton = () => (
  <Loading label={NOTIFICATIONS_COPY.loading}>
    <ul className={styles.list}>
      {['first', 'second', 'third'].map((row) => (
        <li key={row} className={styles.row}>
          <Bone shape="small" width="most" />
        </li>
      ))}
    </ul>
  </Loading>
)

/**
 * Every notification the signed-in account's screens showed, newest first,
 * so a toast missed while away can be read later. The server keeps each
 * account's own and answers no one else's.
 */
export const NotificationsPage = () => {
  const notifications = useQuery(notificationsQuery)
  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <BackButton fallback={HOME} className={styles.back} />
        <hgroup className={styles.heading}>
          <PageTitle icon="bell">{NOTIFICATIONS_COPY.title}</PageTitle>
          {notifications.data && notifications.data.length > 0 && (
            <p className={styles.summary}>
              {NOTIFICATIONS_COPY.summary(notifications.data.length)}
            </p>
          )}
        </hgroup>
      </header>
      {notifications.isError && (
        <p role="alert">
          {NOTIFICATIONS_COPY.serverDidNotAnswer}
          {notifications.error.message}
        </p>
      )}
      {notifications.isPending && <RowsSkeleton />}
      {notifications.data && notifications.data.length === 0 && (
        <p className={styles.summary}>{NOTIFICATIONS_COPY.nothingYet}</p>
      )}
      {notifications.data && notifications.data.length > 0 && (
        <ol className={styles.list}>
          {notifications.data.map((notification) => (
            <NotificationRow key={notification.id} notification={notification} />
          ))}
        </ol>
      )}
    </section>
  )
}
