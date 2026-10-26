import type { RatingsRefresh } from '@raven/core'
import { useCanManage } from '@/lib/management'
import styles from '@/components/RatingsStatus/RatingsStatus.module.scss'

const count = new Intl.NumberFormat()

const WAITING = {
  budget: 'the rest after midnight UTC (daily limit)',
  unavailable: 'waiting for the ratings service',
} as const satisfies Record<Extract<RatingsRefresh, { state: 'waiting' }>['reason'], string>

const noteOf = (refresh: RatingsRefresh): string | null => {
  switch (refresh.state) {
    case 'idle':
      return null
    case 'running':
      return `Updating ratings · ${count.format(refresh.done)} of ${count.format(refresh.total)}`
    case 'waiting':
      return `Ratings: ${count.format(refresh.done)} of ${count.format(refresh.total)} · ${WAITING[refresh.reason]}`
    default: {
      const unreachable: never = refresh
      return unreachable
    }
  }
}

type RatingsStatusProps = { refresh: RatingsRefresh }

/**
 * What Update ratings has done, so far, while it runs or waits and the
 * admin lock is off, as the button that starts it is. `done` counts the
 * titles given up on, so it can jump; and a daily limit can hold it while
 * the other sources are still asked. Idle says nothing, as a finished
 * update may have had nothing to ask for. The live region stays mounted,
 * as ScanStatus's does, so a screen reader hears the first line and
 * when it goes.
 */
export const RatingsStatus = ({ refresh }: RatingsStatusProps) => {
  const canManage = useCanManage()
  if (!canManage) return null
  return (
    <p className={styles.status} aria-live="polite">
      {noteOf(refresh)}
    </p>
  )
}
