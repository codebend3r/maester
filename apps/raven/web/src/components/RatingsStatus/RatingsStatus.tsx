import { RATINGS_REFRESH_STATES, type RatingsRefresh } from '@raven/core'
import { RATINGS_STATUS_COPY } from '@/components/RatingsStatus/copy'
import { useCanManage } from '@/lib/management'
import styles from '@/components/RatingsStatus/RatingsStatus.module.scss'

const WAITING = {
  budget: RATINGS_STATUS_COPY.budget,
  unavailable: RATINGS_STATUS_COPY.unavailable,
} as const satisfies Record<
  Extract<RatingsRefresh, { state: typeof RATINGS_REFRESH_STATES.waiting }>['reason'],
  string
>

const noteOf = (refresh: RatingsRefresh): string | null => {
  switch (refresh.state) {
    case RATINGS_REFRESH_STATES.idle:
      return null
    case RATINGS_REFRESH_STATES.running:
      return RATINGS_STATUS_COPY.updating(refresh)
    case RATINGS_REFRESH_STATES.waiting:
      return RATINGS_STATUS_COPY.waiting({ ...refresh, why: WAITING[refresh.reason] })
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
export const RatingsStatus = ({ refresh }: RatingsStatusProps) =>
  useCanManage() && (
    <p className={styles.status} aria-live="polite">
      {noteOf(refresh)}
    </p>
  )
