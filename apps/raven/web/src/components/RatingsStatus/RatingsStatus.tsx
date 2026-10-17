import type { RatingsRefresh } from '@raven/core'
import { useCanManage } from '@/lib/adminLock'
import styles from '@/components/RatingsStatus/RatingsStatus.module.scss'

const count = new Intl.NumberFormat()

/**
 * What the ratings Refresh has done, so far, while it runs or waits and the
 * admin lock is off, as the button that starts it is. `done` counts the
 * titles given up on, so it can jump; and a daily limit can hold it while
 * the other sources are still asked. Idle says nothing, as a finished
 * Refresh may have had nothing to ask for.
 */
export const RatingsStatus = ({ refresh }: { refresh: RatingsRefresh }) => {
  const canManage = useCanManage()
  if (!canManage) return null
  switch (refresh.state) {
    case 'idle':
      return null
    case 'running':
      return (
        <p className={styles.status} aria-live="polite">
          Refreshing ratings · {count.format(refresh.done)} of {count.format(refresh.total)}
        </p>
      )
    case 'waiting':
      return (
        <p className={styles.status} aria-live="polite">
          Ratings: {count.format(refresh.done)} of {count.format(refresh.total)} ·{' '}
          {refresh.reason === 'budget'
            ? 'the rest after midnight UTC (daily limit)'
            : 'waiting for the ratings service'}
        </p>
      )
    default: {
      const unreachable: never = refresh
      return unreachable
    }
  }
}
